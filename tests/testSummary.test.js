import { describe, it, expect } from 'vitest';
import { formatRunComplete } from '../src/testSummary.js';

const handlers = [
  { id: 's1', name: 'Login', type: 'suite' },
  { id: 't1', name: 'shows error on wrong password', parent: 's1', type: 'test' },
  { id: 't2', name: 'redirects on success', parent: 's1', type: 'test' },
  { id: 't3', name: 'validates email', parent: 's1', type: 'test' },
];

describe('formatRunComplete', () => {
  it('formats an all-pass run as the three-line block', () => {
    const block = formatRunComplete({
      testStatus: [
        { id: 't1', status: 'pass' },
        { id: 't2', status: 'pass' },
      ],
      handlers,
      durationMs: 4200,
    });
    expect(block).toBe(
      '--- Run complete ---\n' +
      '  Passed: 2 | Failed: 0 | Skipped: 0\n' +
      '  Duration: 4.2s'
    );
  });

  // A merged report keeps only the first shard's handlers, and twd-js ids are
  // random per page load, so a later shard's failure cannot be resolved from
  // them — it used to print as a raw id in the merged summary. Each entry now
  // carries the path its own shard resolved.
  it('prefers the path the shard resolved over its own handler lookup', () => {
    const block = formatRunComplete({
      testStatus: [
        { id: 'k3j2h1g9d', path: 'Cart > removes an item', status: 'fail', error: 'boom' },
        { id: 'z9y8x7w6v', path: 'Cart > applies a coupon', status: 'pass', retryAttempt: 2 },
      ],
      handlers,
      durationMs: 1000,
    });
    expect(block).toContain('× Cart > removes an item');
    expect(block).toContain('✓ Cart > applies a coupon (passed on attempt 2)');
    expect(block).not.toContain('k3j2h1g9d');
    expect(block).not.toContain('z9y8x7w6v');
  });

  // A live non-sharded run carries no path, and a null path is a legal value.
  it('falls back to the handler lookup, then the raw id', () => {
    const block = formatRunComplete({
      testStatus: [
        { id: 't1', status: 'fail', error: 'a' },
        { id: 't2', path: null, status: 'fail', error: 'b' },
        { id: 'ghost', status: 'fail', error: 'c' },
      ],
      handlers,
      durationMs: 1000,
    });
    expect(block).toContain('× Login > shows error on wrong password');
    expect(block).toContain('× Login > redirects on success');
    expect(block).toContain('× ghost');
  });

  it('counts skipped tests', () => {
    const block = formatRunComplete({
      testStatus: [
        { id: 't1', status: 'pass' },
        { id: 't2', status: 'skip' },
      ],
      handlers,
      durationMs: 1000,
    });
    expect(block).toContain('  Passed: 1 | Failed: 0 | Skipped: 1');
  });

  it('appends the failure block with suite path and indented error', () => {
    const block = formatRunComplete({
      testStatus: [
        { id: 't1', status: 'fail', error: 'Expected element to be visible (at http://localhost:5173/login)' },
        { id: 't2', status: 'pass' },
        { id: 't3', status: 'fail', error: 'Timeout waiting for selector ".error"' },
      ],
      handlers,
      durationMs: 4200,
    });
    expect(block).toBe(
      '--- Run complete ---\n' +
      '  Passed: 1 | Failed: 2 | Skipped: 0\n' +
      '  Duration: 4.2s\n' +
      '\n' +
      '  Failed tests (2):\n' +
      '    × Login > shows error on wrong password\n' +
      '      Expected element to be visible (at http://localhost:5173/login)\n' +
      '    × Login > validates email\n' +
      '      Timeout waiting for selector ".error"'
    );
  });

  it('indents multi-line error messages to align under the test line', () => {
    const block = formatRunComplete({
      testStatus: [{ id: 't1', status: 'fail', error: 'line one\nline two' }],
      handlers,
      durationMs: 500,
    });
    expect(block).toContain('      line one\n      line two');
  });

  it('falls back to the test id when no handler matches', () => {
    const block = formatRunComplete({
      testStatus: [{ id: 'ghost-id', status: 'fail', error: 'boom' }],
      handlers: [],
      durationMs: 500,
    });
    expect(block).toContain('    × ghost-id');
  });

  it('omits the failure block when everything passes', () => {
    const block = formatRunComplete({
      testStatus: [{ id: 't1', status: 'pass' }],
      handlers,
      durationMs: 500,
    });
    expect(block).not.toContain('Failed tests');
  });

  it('appends the retried block for tests that passed on retry', () => {
    const block = formatRunComplete({
      testStatus: [
        { id: 't1', status: 'pass', retryAttempt: 2 },
        { id: 't2', status: 'pass' },
      ],
      handlers,
      durationMs: 500,
    });
    expect(block).toContain(
      '\n' +
      '  Retried (1):\n' +
      '    ✓ Login > shows error on wrong password (passed on attempt 2)'
    );
  });

  it('omits the retried block when no test was retried', () => {
    const block = formatRunComplete({
      testStatus: [{ id: 't1', status: 'pass' }],
      handlers,
      durationMs: 500,
    });
    expect(block).not.toContain('Retried');
  });

  it('contains no ANSI escape codes', () => {
    const block = formatRunComplete({
      testStatus: [
        { id: 't1', status: 'fail', error: 'boom' },
        { id: 't2', status: 'pass', retryAttempt: 2 },
        { id: 't3', status: 'skip' },
      ],
      handlers,
      durationMs: 500,
    });
    expect(/\x1b\[[0-9;]*m/.test(block)).toBe(false);
  });

  it('adds a "Not run" line when notRun > 0', () => {
    const block = formatRunComplete({
      testStatus: [{ id: 't1', status: 'pass' }],
      handlers,
      durationMs: 1000,
      notRun: 3,
    });
    expect(block).toContain('  Not run: 3');
  });

  it('omits the "Not run" line when notRun is 0', () => {
    const block = formatRunComplete({
      testStatus: [{ id: 't1', status: 'pass' }],
      handlers,
      durationMs: 1000,
    });
    expect(block).not.toContain('Not run');
  });

  it('appends an early-stop banner when stoppedEarly is true', () => {
    const block = formatRunComplete({
      testStatus: [
        { id: 't1', status: 'fail', error: 'boom' },
        { id: 't2', status: 'fail', error: 'boom' },
      ],
      handlers,
      durationMs: 1000,
      notRun: 5,
      stoppedEarly: true,
      maxFailures: 2,
    });
    expect(block).toContain('Stopped early');
    expect(block).toContain('maxFailures=2');
    expect(block).toContain('5 test(s) were not run');
    expect(block).toContain('"maxFailures": 0');
  });

  it('does not claim "0 test(s) were not run" when nothing was skipped', () => {
    const block = formatRunComplete({
      testStatus: [
        { id: 't1', status: 'fail', error: 'boom' },
        { id: 't2', status: 'fail', error: 'boom' },
      ],
      handlers,
      durationMs: 1000,
      notRun: 0,
      stoppedEarly: true,
      maxFailures: 2,
    });
    expect(block).toContain('Stopped early');
    expect(block).not.toContain('0 test(s) were not run');
  });
});

describe('formatRunComplete with shards', () => {
  const handlers = [
    { id: 's1', name: 'Login', parent: null, type: 'suite' },
    { id: 't1', name: 'works', parent: 's1', type: 'test' },
  ];
  const testStatus = [{ id: 't1', status: 'pass' }];

  function shard(index, overrides = {}) {
    return { index, total: 4, executed: 30, failed: 0, notRun: 0, stoppedEarly: false, ...overrides };
  }

  it('adds a shard breakdown line when more than one shard merged', () => {
    const output = formatRunComplete({
      testStatus, handlers, durationMs: 38_200, computeMs: 134_200,
      shards: [shard(1), shard(2, { failed: 3 }), shard(3), shard(4)],
    });
    expect(output).toContain('Shards: 1 ✓30 | 2 ✗30 | 3 ✓30 | 4 ✓30');
  });

  it('reports wall clock and compute separately for a merged run', () => {
    const output = formatRunComplete({
      testStatus, handlers, durationMs: 38_200, computeMs: 134_200,
      shards: [shard(1), shard(2)],
    });
    expect(output).toContain('Duration: 38.2s wall | 134.2s across 2 shards');
  });

  // The existing single-run format must not shift.
  it('keeps the plain duration line when there are no shards', () => {
    const output = formatRunComplete({ testStatus, handlers, durationMs: 4_200 });
    expect(output).toContain('Duration: 4.2s');
    expect(output).not.toContain('wall');
    expect(output).not.toContain('Shards:');
  });

  it('keeps the plain duration line for a single shard', () => {
    const output = formatRunComplete({
      testStatus, handlers, durationMs: 4_200, computeMs: 4_200, shards: [shard(1, { total: 1 })],
    });
    expect(output).toContain('Duration: 4.2s');
    expect(output).not.toContain('Shards:');
  });
});

// The diagnostics snapshot travels out of the page as raw data on the failure
// entry (src/index.js), and is rendered here rather than in twd-js. See
// src/failureDiagnostics.js for why the split sits where it does.
describe('formatRunComplete diagnostics block', () => {
  const failing = (diagnostics) => ({
    id: 't1',
    status: 'fail',
    diagnostics,
    error: 'AssertionError: expected 0 rows (at http://localhost:5173/cg-1/settings/catalog)',
  });

  it('prints the mock-rule row above the error message', () => {
    const output = formatRunComplete({
      testStatus: [failing({
        location: '/cg-1/settings/catalog',
        mockRules: { registered: 7, triggered: 6, untriggered: ['catalog'] },
      })],
      handlers,
      durationMs: 1000,
    });
    expect(output).toContain(
      '    × Login > shows error on wrong password\n' +
      '      mock rules  6/7 triggered — catalog never requested\n' +
      '      AssertionError: expected 0 rows (at http://localhost:5173/cg-1/settings/catalog)'
    );
  });

  it('indents every row of a multi-alias block to the error column', () => {
    const output = formatRunComplete({
      testStatus: [failing({
        location: '/cg-1',
        mockRules: { registered: 4, triggered: 1, untriggered: ['catalog', 'profile'] },
      })],
      handlers,
      durationMs: 1000,
    });
    expect(output).toContain(
      '      mock rules  1/4 triggered — 2 never requested\n' +
      '                  ✗ catalog\n' +
      '                  ✗ profile\n'
    );
  });

  // twd-js 1.9.0 and earlier send no snapshot at all. The failure must print
  // exactly as it always has.
  it('is byte-identical to the old output when no snapshot is present', () => {
    const args = { handlers, durationMs: 1000 };
    const withField = formatRunComplete({ testStatus: [failing(undefined)], ...args });
    const withoutField = formatRunComplete({
      testStatus: [{ id: 't1', status: 'fail', error: failing().error }],
      ...args,
    });
    expect(withField).toBe(withoutField);
    expect(withField).not.toContain('mock rules');
  });

  // A test that failed an attempt then passed carries no snapshot on the pass
  // entry, so a retried-then-green run stays clean.
  it('prints no block for a test that passed on retry', () => {
    const output = formatRunComplete({
      testStatus: [{ id: 't1', status: 'pass', retryAttempt: 2 }],
      handlers,
      durationMs: 1000,
    });
    expect(output).not.toContain('mock rules');
    expect(output).toContain('Retried (1):');
  });
});
