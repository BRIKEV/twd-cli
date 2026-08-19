import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs');
vi.mock('../src/config.js', () => ({ loadConfig: vi.fn() }));
vi.mock('../src/contractReport.js', () => ({ printContractReport: vi.fn() }));
vi.mock('../src/reportFiles.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, readShardReports: vi.fn(), readShardCoverage: vi.fn() };
});

import fs from 'fs';
import { loadConfig } from '../src/config.js';
import { printContractReport } from '../src/contractReport.js';
import { readShardReports, readShardCoverage } from '../src/reportFiles.js';
import { runMerge } from '../src/mergeCommand.js';

const HANDLERS = [
  { id: 's1', name: 'Login', parent: null, type: 'suite' },
  { id: 't1', name: 'a', parent: 's1', type: 'test' },
  { id: 't2', name: 'b', parent: 's1', type: 'test' },
];

function shardReport(index, overrides = {}) {
  const { total = 2, tests = [{ id: `t${index}`, status: 'pass' }], failed = 0 } = overrides;
  return {
    schemaVersion: 1,
    shards: [{
      index, total,
      startedAt: `2026-08-19T10:00:0${index}.000Z`,
      endedAt: `2026-08-19T10:00:1${index}.000Z`,
      durationMs: 10_000,
      executed: 1, notRun: 0, failed,
      stoppedEarly: false, coverageFile: 'coverage.json', recording: null,
    }],
    discovery: { totalTests: 2, fingerprint: 'sha256:same' },
    selection: { filters: [] },
    handlers: HANDLERS,
    tests,
    contracts: { configured: false, partial: false, results: [], skipped: [] },
  };
}

const baseConfig = {
  coverage: true,
  nycOutputDir: './.nyc_output',
  maxFailures: 10,
};

function writtenFiles() {
  return vi.mocked(fs.writeFileSync).mock.calls.map(([f]) => String(f));
}

describe('runMerge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadConfig).mockReturnValue({ ...baseConfig });
    vi.mocked(readShardCoverage).mockReturnValue(null);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requires a directory', () => {
    expect(() => runMerge({})).toThrow(/Usage: twd-cli merge/);
  });

  it('errors when no shard reports were found', () => {
    vi.mocked(readShardReports).mockReturnValue([]);
    expect(() => runMerge({ dir: '.twd/shards' })).toThrow(/No shard reports found/);
  });

  // The failure that must never be silent: three green shards and one that
  // never uploaded would otherwise read as a complete green run.
  it('errors and names the gap when a shard is missing', () => {
    vi.mocked(readShardReports).mockReturnValue([{ dir: 'a', report: shardReport(1) }]);
    expect(() => runMerge({ dir: '.twd/shards' })).toThrow(/Missing shard report\(s\): 2\/2/);
  });

  it('mentions if: always() in the missing-shard message', () => {
    vi.mocked(readShardReports).mockReturnValue([{ dir: 'a', report: shardReport(2) }]);
    expect(() => runMerge({ dir: '.twd/shards' })).toThrow(/if: always\(\)/);
  });

  it('writes the merged report to the default path', () => {
    vi.mocked(readShardReports).mockReturnValue([
      { dir: 'a', report: shardReport(1) },
      { dir: 'b', report: shardReport(2) },
    ]);

    expect(runMerge({ dir: '.twd/shards' })).toBe(false);

    const merged = writtenFiles().find((f) => f.endsWith('merged-run.json'));
    expect(merged).toBeDefined();
  });

  it('honors --out', () => {
    vi.mocked(readShardReports).mockReturnValue([
      { dir: 'a', report: shardReport(1) },
      { dir: 'b', report: shardReport(2) },
    ]);

    runMerge({ dir: '.twd/shards', out: 'custom.json' });

    expect(writtenFiles().some((f) => f.endsWith('custom.json'))).toBe(true);
  });

  // readShardReports returns readdir order, which is lexicographic, so
  // twd-run-10 comes back before twd-run-2. mergeRunReports sorts shards[] by
  // index but concatenates tests in argument order, so without a sort here the
  // merged artifact's test order and its shard list would disagree.
  it('merges shards in index order whatever order they were found in', () => {
    vi.mocked(readShardReports).mockReturnValue([
      { dir: 'twd-run-2', report: shardReport(2) },
      { dir: 'twd-run-1', report: shardReport(1) },
    ]);

    runMerge({ dir: '.twd/shards' });

    const call = vi.mocked(fs.writeFileSync).mock.calls
      .find(([f]) => String(f).endsWith('merged-run.json'));
    const merged = JSON.parse(String(call[1]));
    expect(merged.tests.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(merged.shards.map((s) => s.index)).toEqual([1, 2]);
  });

  it('returns true when any shard had a failing test', () => {
    vi.mocked(readShardReports).mockReturnValue([
      { dir: 'a', report: shardReport(1) },
      { dir: 'b', report: shardReport(2, { tests: [{ id: 't2', status: 'fail', error: 'boom' }], failed: 1 }) },
    ]);

    expect(runMerge({ dir: '.twd/shards' })).toBe(true);
  });

  it('merges coverage when the run is green', () => {
    vi.mocked(readShardReports).mockReturnValue([
      { dir: 'a', report: shardReport(1) },
      { dir: 'b', report: shardReport(2) },
    ]);
    vi.mocked(readShardCoverage).mockReturnValue({});

    runMerge({ dir: '.twd/shards' });

    expect(writtenFiles().some((f) => f.includes('.nyc_output'))).toBe(true);
  });

  // The user's rule, applied to the true global result rather than one shard's.
  it('skips merged coverage when the run is red', () => {
    vi.mocked(readShardReports).mockReturnValue([
      { dir: 'a', report: shardReport(1) },
      { dir: 'b', report: shardReport(2, { tests: [{ id: 't2', status: 'fail', error: 'boom' }], failed: 1 }) },
    ]);
    vi.mocked(readShardCoverage).mockReturnValue({});

    runMerge({ dir: '.twd/shards' });

    expect(writtenFiles().some((f) => f.includes('.nyc_output'))).toBe(false);
  });

  it('reports how many shards contributed coverage', () => {
    const log = vi.spyOn(console, 'log');
    vi.mocked(readShardReports).mockReturnValue([
      { dir: 'a', report: shardReport(1) },
      { dir: 'b', report: shardReport(2) },
    ]);
    vi.mocked(readShardCoverage).mockReturnValueOnce({}).mockReturnValueOnce(null);

    runMerge({ dir: '.twd/shards' });

    expect(log.mock.calls.flat().join('\n')).toMatch(/Coverage merged from 1\/2 shards/);
  });

  it('says so when no shard had coverage', () => {
    const log = vi.spyOn(console, 'log');
    vi.mocked(readShardReports).mockReturnValue([
      { dir: 'a', report: shardReport(1) },
      { dir: 'b', report: shardReport(2) },
    ]);

    runMerge({ dir: '.twd/shards' });

    expect(log.mock.calls.flat().join('\n')).toMatch(/No coverage data found/);
  });

  it('returns true when contracts report an error-mode violation', () => {
    const withContracts = (i) => ({
      ...shardReport(i),
      contracts: { configured: true, partial: false, results: [{ alias: 'a' }], skipped: [] },
    });
    vi.mocked(readShardReports).mockReturnValue([
      { dir: 'a', report: withContracts(1) },
      { dir: 'b', report: withContracts(2) },
    ]);
    vi.mocked(printContractReport).mockReturnValue(true);

    expect(runMerge({ dir: '.twd/shards' })).toBe(true);
  });

  it('warns when contract data is partial', () => {
    const warn = vi.spyOn(console, 'warn');
    const partial = (i, isPartial) => ({
      ...shardReport(i),
      contracts: { configured: true, partial: isPartial, results: [], skipped: [] },
    });
    vi.mocked(readShardReports).mockReturnValue([
      { dir: 'a', report: partial(1, false) },
      { dir: 'b', report: partial(2, true) },
    ]);
    vi.mocked(printContractReport).mockReturnValue(false);

    runMerge({ dir: '.twd/shards' });

    expect(warn.mock.calls.flat().join('\n')).toMatch(/contract data is partial/i);
  });

  // A sharded run skips the markdown report on purpose — each shard would
  // overwrite the others with a quarter of the picture. Merge is where the whole
  // picture exists, so this is the only place it can be written.
  it('writes the contract markdown report that sharded runs skip', () => {
    vi.mocked(loadConfig).mockReturnValue({ ...baseConfig, contractReportPath: './contract-report.md' });
    const configured = (i) => ({
      ...shardReport(i),
      contracts: { configured: true, partial: false, results: [], skipped: [] },
    });
    vi.mocked(readShardReports).mockReturnValue([
      { dir: 'a', report: configured(1) },
      { dir: 'b', report: configured(2) },
    ]);
    vi.mocked(printContractReport).mockReturnValue(false);

    runMerge({ dir: '.twd/shards' });

    expect(writtenFiles().some((f) => f.endsWith('contract-report.md'))).toBe(true);
  });

  // Executed + not-run has to account for every discovered test. When it does
  // not, the shard math dropped tests on the floor and nothing else would say so.
  it('warns when the shard totals do not account for every discovered test', () => {
    const warn = vi.spyOn(console, 'warn');
    const wrongTotal = (i) => ({
      ...shardReport(i),
      discovery: { totalTests: 3, fingerprint: 'sha256:same' },
    });
    vi.mocked(readShardReports).mockReturnValue([
      { dir: 'a', report: wrongTotal(1) },
      { dir: 'b', report: wrongTotal(2) },
    ]);

    runMerge({ dir: '.twd/shards' });

    expect(warn.mock.calls.flat().join('\n')).toMatch(/shard totals do not add up/);
  });

  it('prints the merged run-complete block with a shard breakdown', () => {
    const log = vi.spyOn(console, 'log');
    vi.mocked(readShardReports).mockReturnValue([
      { dir: 'a', report: shardReport(1) },
      { dir: 'b', report: shardReport(2) },
    ]);

    runMerge({ dir: '.twd/shards' });

    const output = log.mock.calls.flat().join('\n');
    expect(output).toContain('--- Run complete ---');
    expect(output).toContain('Shards: 1 ✓1 | 2 ✓1');
  });
});
