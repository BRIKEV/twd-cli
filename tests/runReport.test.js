import { describe, it, expect } from 'vitest';
import { buildRunReport, fingerprintTests, REPORT_SCHEMA_VERSION } from '../src/runReport.js';

const handlers = [
  { id: 's1', name: 'Login', parent: null, type: 'suite' },
  { id: 't1', name: 'works', parent: 's1', type: 'test' },
];

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
  it('changes when the id order changes', () => {
    expect(fingerprintTests(['a', 'b'])).not.toBe(fingerprintTests(['b', 'a']));
  });

  it('changes when the id set changes', () => {
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
    expect(report.discovery.fingerprint).toBe(fingerprintTests(['t1', 't2', 't3'], []));
  });

  it('carries handlers and tests through untouched', () => {
    const report = build();
    expect(report.handlers).toEqual(handlers);
    expect(report.tests).toEqual([{ id: 't1', status: 'pass' }]);
  });

  it('copies the filters rather than aliasing them', () => {
    const filters = ['Login'];
    const report = build({ filters });
    filters.push('Cart');
    expect(report.selection.filters).toEqual(['Login']);
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
