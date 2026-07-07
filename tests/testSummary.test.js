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
});
