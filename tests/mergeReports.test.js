import { describe, it, expect } from 'vitest';
import {
  mergeRunReports,
  findMissingShards,
  reportTimings,
  reportTotals,
} from '../src/mergeReports.js';
import { REPORT_SCHEMA_VERSION } from '../src/runReport.js';

const HANDLERS = [
  { id: 's1', name: 'Login', parent: null, type: 'suite' },
  { id: 't1', name: 'a', parent: 's1', type: 'test' },
  { id: 't2', name: 'b', parent: 's1', type: 'test' },
  { id: 't3', name: 'c', parent: 's1', type: 'test' },
];

const FINGERPRINT = 'sha256:deadbeef';

// Ids are per-page-load random in reality, so shard n's report carries ids
// nothing else can resolve. index (position in the discovered order) and path
// are what stay stable, and they are what the merge relies on.
function makeReport(index, overrides = {}) {
  const {
    total = 3,
    tests = [{ id: `r${index}-t`, path: `Login > ${'abc'[index - 1]}`, index: index - 1, status: 'pass' }],
    startedAt = `2026-08-19T10:00:0${index}.000Z`,
    endedAt = `2026-08-19T10:00:1${index}.000Z`,
    durationMs = 10_000,
    executed = 1,
    notRun = 0,
    failed = 0,
    stoppedEarly = false,
    coverageFile = 'coverage.json',
    contracts = { configured: true, partial: false, results: [], skipped: [] },
    fingerprint = FINGERPRINT,
    schemaVersion = REPORT_SCHEMA_VERSION,
    totalTests = 3,
    selectedTests = 3,
  } = overrides;

  return {
    schemaVersion,
    shards: [{
      index, total, startedAt, endedAt, durationMs,
      executed, notRun, failed, stoppedEarly, coverageFile, recording: null,
    }],
    discovery: { totalTests, fingerprint },
    selection: { filters: [], selectedTests },
    handlers: HANDLERS,
    tests,
    contracts,
  };
}

describe('mergeRunReports', () => {
  it('concatenates tests across shards', () => {
    const merged = mergeRunReports([makeReport(1), makeReport(2), makeReport(3)]);
    expect(merged.tests.map((t) => t.index)).toEqual([0, 1, 2]);
    expect(merged.tests.map((t) => t.path)).toEqual(['Login > a', 'Login > b', 'Login > c']);
  });

  it('sorts shard descriptors by index regardless of input order', () => {
    const merged = mergeRunReports([makeReport(3), makeReport(1), makeReport(2)]);
    expect(merged.shards.map((s) => s.index)).toEqual([1, 2, 3]);
  });

  it('keeps the single-report shape', () => {
    const merged = mergeRunReports([makeReport(1), makeReport(2), makeReport(3)]);
    expect(Object.keys(merged).sort()).toEqual(
      ['contracts', 'discovery', 'handlers', 'schemaVersion', 'selection', 'shards', 'tests'],
    );
    expect(merged.handlers).toEqual(HANDLERS);
    expect(merged.discovery).toEqual({ totalTests: 3, fingerprint: FINGERPRINT });
  });

  // Locks the documented first-wins semantics. These fields are invariant across
  // valid shards by construction, so nothing upstream distinguishes first from
  // last — only this test does.
  it('takes discovery, selection, handlers and contracts.configured from the first report', () => {
    const first = makeReport(1, { totalTests: 3 });
    const second = makeReport(2, { totalTests: 3 });
    second.discovery = { ...second.discovery, totalTests: 99 };
    second.selection = { filters: ['not-the-first'] };
    second.handlers = [{ id: 'other', name: 'Other', parent: null, type: 'suite' }];
    second.contracts = { ...second.contracts, configured: false };

    const merged = mergeRunReports([first, second]);

    expect(merged.discovery.totalTests).toBe(3);
    expect(merged.selection).toEqual({ filters: [], selectedTests: 3 });
    expect(merged.handlers).toEqual(HANDLERS);
    expect(merged.contracts.configured).toBe(true);
  });

  // The property that proves nothing is lost or doubled. It only holds because
  // completeness is checked outside this function.
  it('is associative', () => {
    const a = makeReport(1);
    const b = makeReport(2);
    const c = makeReport(3);
    expect(mergeRunReports([mergeRunReports([a, b]), c]))
      .toEqual(mergeRunReports([a, b, c]));
    expect(mergeRunReports([a, mergeRunReports([b, c])]))
      .toEqual(mergeRunReports([a, b, c]));
  });

  it('accepts a partial merge without complaining about gaps', () => {
    const merged = mergeRunReports([makeReport(1), makeReport(2)]);
    expect(merged.shards.map((s) => s.index)).toEqual([1, 2]);
  });

  it('concatenates contract results and skipped entries', () => {
    const merged = mergeRunReports([
      makeReport(1, { contracts: { configured: true, partial: false, results: [{ alias: 'a' }], skipped: [{ alias: 'x' }] } }),
      makeReport(2, { contracts: { configured: true, partial: false, results: [{ alias: 'b' }], skipped: [] } }),
    ]);
    expect(merged.contracts.results).toEqual([{ alias: 'a' }, { alias: 'b' }]);
    expect(merged.contracts.skipped).toEqual([{ alias: 'x' }]);
  });

  it('ORs the contracts partial flag', () => {
    const partial = makeReport(2, { contracts: { configured: true, partial: true, results: [], skipped: [] } });
    expect(mergeRunReports([makeReport(1), partial]).contracts.partial).toBe(true);
    expect(mergeRunReports([makeReport(1), makeReport(2)]).contracts.partial).toBe(false);
  });

  it('throws on an empty input', () => {
    expect(() => mergeRunReports([])).toThrow(/No shard reports/);
  });

  it('throws when schema versions disagree', () => {
    expect(() => mergeRunReports([
      makeReport(1),
      makeReport(2, { schemaVersion: REPORT_SCHEMA_VERSION + 1 }),
    ])).toThrow(/schemaVersion/);
  });

  // Agreeing with each other is not enough. Reports from a newer twd-cli agree,
  // and merging them against a schema this binary does not know is the silent
  // mis-merge the field exists to prevent.
  it('throws when every shard agrees on a version this build does not read', () => {
    const future = REPORT_SCHEMA_VERSION + 1;
    expect(() => mergeRunReports([
      makeReport(1, { schemaVersion: future }),
      makeReport(2, { schemaVersion: future }),
    ])).toThrow(new RegExp(`schema v${future}, but this twd-cli reads v${REPORT_SCHEMA_VERSION}`));
  });

  // The safety net: shards that saw different test sets must never be combined.
  it('throws when fingerprints disagree', () => {
    expect(() => mergeRunReports([makeReport(1), makeReport(2, { fingerprint: 'sha256:other' })]))
      .toThrow(/different test sets/);
  });

  it('throws when shard totals disagree', () => {
    expect(() => mergeRunReports([makeReport(1), makeReport(2, { total: 4 })]))
      .toThrow(/shard total/);
  });

  it('throws when the same shard index appears twice', () => {
    expect(() => mergeRunReports([makeReport(1), makeReport(1)]))
      .toThrow(/more than once/);
  });

  // Overlap is keyed on position, not id: shards never agree on ids, so the old
  // id check could not fire at all.
  it('throws when the same position appears in two shards', () => {
    expect(() => mergeRunReports([
      makeReport(1, { tests: [{ id: 'aaa', path: 'Login > a', index: 0, status: 'pass' }] }),
      makeReport(2, { tests: [{ id: 'zzz', path: 'Login > a', index: 0, status: 'pass' }] }),
    ])).toThrow(/"Login > a" \(position 0\) appears in more than one shard/);
  });

  // Two tests may legitimately share a "suite > test" path and land in
  // different shards. Keying identity on the path would fail a correct run.
  it('accepts duplicate paths in different shards when the positions differ', () => {
    const merged = mergeRunReports([
      makeReport(1, { tests: [{ id: 'aaa', path: 'Login > a', index: 0, status: 'pass' }] }),
      makeReport(2, { tests: [{ id: 'zzz', path: 'Login > a', index: 1, status: 'pass' }] }),
    ]);
    expect(merged.tests).toHaveLength(2);
  });

  it('does not mutate the input reports', () => {
    const a = makeReport(1);
    const b = makeReport(2);
    mergeRunReports([b, a]);
    expect(a.shards).toHaveLength(1);
    expect(b.shards[0].index).toBe(2);
  });
});

describe('findMissingShards', () => {
  it('returns an empty array when every shard is present', () => {
    expect(findMissingShards(mergeRunReports([makeReport(1), makeReport(2), makeReport(3)])))
      .toEqual([]);
  });

  it('names the gaps', () => {
    expect(findMissingShards(mergeRunReports([makeReport(1), makeReport(3)]))).toEqual([2]);
    expect(findMissingShards(mergeRunReports([makeReport(2)]))).toEqual([1, 3]);
  });
});

describe('reportTimings', () => {
  // Wall clock is what the developer waited; compute is what was paid for.
  it('reports wall clock as the span and compute as the sum', () => {
    const merged = mergeRunReports([makeReport(1), makeReport(2), makeReport(3)]);
    // starts 10:00:01..03, ends 10:00:11..13 -> span 12s; 3 x 10s compute
    expect(reportTimings(merged)).toEqual({ wallMs: 12_000, computeMs: 30_000 });
  });

  it('makes wall and compute equal for a single shard', () => {
    const single = mergeRunReports([makeReport(1, { total: 1 })]);
    const { wallMs, computeMs } = reportTimings(single);
    expect(wallMs).toBe(computeMs);
  });
});

describe('reportTotals', () => {
  it('sums executed and notRun and confirms they account for the selection', () => {
    const merged = mergeRunReports([makeReport(1), makeReport(2), makeReport(3)]);
    expect(reportTotals(merged))
      .toEqual({ executed: 3, notRun: 0, expected: 3, consistent: true });
  });

  it('flags totals that do not add up to the selected count', () => {
    const merged = mergeRunReports([makeReport(1), makeReport(2)]);
    expect(reportTotals(merged).consistent).toBe(false);
  });

  it('counts a bailed shard\'s notRun', () => {
    const merged = mergeRunReports([
      makeReport(1),
      makeReport(2, { executed: 1, notRun: 1, stoppedEarly: true, failed: 1 }),
      makeReport(3),
    ]);
    expect(reportTotals(merged))
      .toEqual({ executed: 3, notRun: 1, expected: 3, consistent: false });
  });

  // The regression this fixes: --test narrows what the shards divide, so
  // comparing against every discovered test called a correct run a slicing bug.
  it('measures a filtered run against the filtered count, not the whole suite', () => {
    const merged = mergeRunReports([
      makeReport(1, { totalTests: 40, selectedTests: 2, tests: [] }),
      makeReport(2, { totalTests: 40, selectedTests: 2, tests: [] }),
    ]);
    expect(reportTotals(merged)).toEqual({ executed: 2, notRun: 0, expected: 2, consistent: true });
  });
});

// A failure's diagnostics snapshot is written by the shard that ran the test
// and rendered by whoever prints the merged summary, so it has to survive the
// merge and a JSON round-trip (embedded newlines in `error` included).
describe('mergeRunReports diagnostics', () => {
  const diagnostics = {
    location: '/cg-1/settings/catalog',
    mockRules: { registered: 7, triggered: 6, untriggered: ['catalog'] },
  };

  it('carries the snapshot through the merge on the failing shard', () => {
    const merged = mergeRunReports([
      makeReport(1, {
        tests: [{ id: 'r1-t', path: 'Login > a', index: 0, status: 'pass' }],
      }),
      makeReport(2, {
        failed: 1,
        tests: [{
          id: 'r2-t',
          path: 'Login > b',
          index: 1,
          status: 'fail',
          diagnostics,
          error: 'AssertionError: expected 0 rows\n  at Object.<anonymous>',
        }],
      }),
    ]);

    const failed = merged.tests.find((t) => t.status === 'fail');
    expect(failed.diagnostics).toEqual(diagnostics);

    const roundTripped = JSON.parse(JSON.stringify(merged));
    const after = roundTripped.tests.find((t) => t.status === 'fail');
    expect(after.diagnostics).toEqual(diagnostics);
    expect(after.error).toContain('\n');
  });

  // Shards produced by a twd-js without diagnostics merge unchanged.
  it('merges reports that carry no snapshot at all', () => {
    const merged = mergeRunReports([
      makeReport(1, {
        failed: 1,
        tests: [{ id: 'r1-t', path: 'Login > a', index: 0, status: 'fail', error: 'boom' }],
      }),
      makeReport(2),
    ]);

    expect(merged.tests.find((t) => t.status === 'fail').diagnostics).toBeUndefined();
  });
});
