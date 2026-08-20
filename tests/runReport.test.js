import { describe, it, expect } from 'vitest';
import { buildRunReport, fingerprintTests, REPORT_SCHEMA_VERSION } from '../src/runReport.js';

const handlers = [
  { id: 's1', name: 'Login', parent: null, type: 'suite' },
  { id: 't1', name: 'works', parent: 's1', type: 'test' },
  { id: 't2', name: 'also works', parent: 's1', type: 'test' },
  { id: 't3', name: 'still works', parent: 's1', type: 'test' },
];

const PATHS = ['Login > works', 'Login > also works', 'Login > still works'];

function build(overrides = {}) {
  return buildRunReport({
    shard: { index: 2, total: 4 },
    startedAt: 1_000,
    endedAt: 4_500,
    allTestIds: ['t1', 't2', 't3'],
    filters: [],
    handlers,
    tests: [{ id: 't1', status: 'pass' }],
    executed: 1,
    notRun: 0,
    stoppedEarly: false,
    ...overrides,
  });
}

describe('fingerprintTests', () => {
  it('is stable for the same input', () => {
    expect(fingerprintTests(['a', 'b'])).toBe(fingerprintTests(['a', 'b']));
  });

  it('is prefixed with the algorithm', () => {
    expect(fingerprintTests(['a'])).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  // Order matters: round-robin slicing is only correct if every shard sees the
  // same list in the same order.
  it('changes when the path order changes', () => {
    expect(fingerprintTests(['a', 'b'])).not.toBe(fingerprintTests(['b', 'a']));
  });

  it('changes when the path set changes', () => {
    expect(fingerprintTests(['a', 'b'])).not.toBe(fingerprintTests(['a', 'b', 'c']));
  });

  it('changes when the filters differ', () => {
    expect(fingerprintTests(['a'], ['Login'])).not.toBe(fingerprintTests(['a'], ['Cart']));
    expect(fingerprintTests(['a'], [])).not.toBe(fingerprintTests(['a'], ['Login']));
  });

  // Filters are OR'd, so their order is not meaningful and must not split
  // otherwise-identical shards.
  it('ignores the order the filters were given in', () => {
    expect(fingerprintTests(['a'], ['Login', 'Cart']))
      .toBe(fingerprintTests(['a'], ['Cart', 'Login']));
  });
});

describe('buildRunReport', () => {
  it('stamps the schema version', () => {
    expect(build().schemaVersion).toBe(REPORT_SCHEMA_VERSION);
  });

  it('wraps a single shard descriptor in an array', () => {
    const report = build();
    expect(report.shards).toHaveLength(1);
    expect(report.shards[0]).toMatchObject({
      index: 2, total: 4, executed: 1, notRun: 0, failed: 0, stoppedEarly: false,
    });
  });

  it('derives durationMs and ISO timestamps from epoch millis', () => {
    const shard = build().shards[0];
    expect(shard.durationMs).toBe(3500);
    expect(shard.startedAt).toBe(new Date(1_000).toISOString());
    expect(shard.endedAt).toBe(new Date(4_500).toISOString());
  });

  it('counts this shard\'s failures', () => {
    const report = build({
      tests: [
        { id: 't1', status: 'pass' },
        { id: 't2', status: 'fail', error: 'boom' },
        { id: 't3', status: 'skip' },
      ],
    });
    expect(report.shards[0].failed).toBe(1);
  });

  it('records total discovered tests and the fingerprint', () => {
    const report = build();
    expect(report.discovery.totalTests).toBe(3);
    expect(report.discovery.fingerprint).toBe(fingerprintTests(PATHS, []));
  });

  // The whole point of the path-based fingerprint: twd-js ids are Math.random()
  // per page load, so two shards of the same suite never agree on ids. If the
  // fingerprint were keyed on them, merge would reject every correct run.
  it('fingerprints the same suite identically when the ids differ', () => {
    const shardTwoHandlers = handlers.map((h) => ({
      ...h,
      id: `x${h.id}`,
      parent: h.parent ? `x${h.parent}` : h.parent,
    }));
    const shardTwo = build({
      allTestIds: ['xt1', 'xt2', 'xt3'],
      handlers: shardTwoHandlers,
      tests: [{ id: 'xt1', status: 'pass' }],
    });
    expect(shardTwo.discovery.fingerprint).toBe(build().discovery.fingerprint);
  });

  it('carries handlers through untouched', () => {
    expect(build().handlers).toEqual(handlers);
  });

  // path is for display, index is for identity. See buildRunReport.
  it('stamps each test with its resolved path and its position in the order', () => {
    expect(build({ tests: [{ id: 't3', status: 'fail', error: 'boom' }] }).tests).toEqual([
      { id: 't3', status: 'fail', error: 'boom', path: 'Login > still works', index: 2 },
    ]);
  });

  // Positions are shard-independent, so a merged report can detect a genuine
  // overlap with them where random ids proved nothing.
  it('numbers positions from the full ordered list, not the shard slice', () => {
    const report = build({
      tests: [{ id: 't2', status: 'pass' }, { id: 't3', status: 'pass' }],
    });
    expect(report.tests.map((t) => t.index)).toEqual([1, 2]);
  });

  // Renderers fall back on a null path; inventing one would be worse.
  it('leaves path null and index null when the handler is missing', () => {
    const report = build({ tests: [{ id: 'ghost', status: 'pass' }] });
    expect(report.tests[0]).toEqual({ id: 'ghost', status: 'pass', path: null, index: null });
  });

  it('copies the filters rather than aliasing them', () => {
    const filters = ['Login'];
    const report = build({ filters });
    filters.push('Cart');
    expect(report.selection.filters).toEqual(['Login']);
  });

  // What executed + notRun has to add up to. With --test active this is smaller
  // than discovery.totalTests, and comparing against the latter reported a
  // shard-slicing bug on every correct filtered run.
  it('records the filtered count the shards divided', () => {
    expect(build({ filteredIds: ['t2', 't3'], filters: ['works'] }).selection.selectedTests)
      .toBe(2);
  });

  it('falls back to the whole suite when no filter is active', () => {
    expect(build().selection.selectedTests).toBe(3);
  });

  it('defaults contracts to an unconfigured empty block', () => {
    expect(build().contracts).toEqual({
      configured: false, partial: false, results: [], skipped: [],
    });
  });

  it('passes a contracts block through when given', () => {
    const contracts = { configured: true, partial: true, results: [{ alias: 'a' }], skipped: [] };
    expect(build({ contracts }).contracts).toEqual(contracts);
  });

  it('defaults coverageFile and recording to null', () => {
    const shard = build().shards[0];
    expect(shard.coverageFile).toBeNull();
    expect(shard.recording).toBeNull();
  });
});
