import { describe, it, expect } from 'vitest';
import { formatTestSummary } from '../src/testSummary.js';
import { formatFailedTestsBlock } from '../src/testSummary.js';

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('formatTestSummary', () => {
  it('formats an all-pass run', () => {
    const line = formatTestSummary({
      testStatus: [
        { id: '1', status: 'pass' },
        { id: '2', status: 'pass' },
        { id: '3', status: 'pass' },
      ],
      durationMs: 1234,
    });
    expect(stripAnsi(line)).toBe('Tests: 3 passed, 0 failed, 0 skipped (3 total) in 0:01.234');
  });

  it('formats a mixed run', () => {
    const line = formatTestSummary({
      testStatus: [
        { id: '1', status: 'pass' },
        { id: '2', status: 'fail' },
        { id: '3', status: 'skip' },
      ],
      durationMs: 83_193,
    });
    expect(stripAnsi(line)).toBe('Tests: 1 passed, 1 failed, 1 skipped (3 total) in 1:23.193');
  });

  it('formats an empty run', () => {
    const line = formatTestSummary({ testStatus: [], durationMs: 0 });
    expect(stripAnsi(line)).toBe('Tests: 0 passed, 0 failed, 0 skipped (0 total) in 0:00.000');
  });

  it('keeps the "Tests:" label uncolored so grep "^Tests:" matches', () => {
    const line = formatTestSummary({
      testStatus: [{ id: '1', status: 'pass' }],
      durationMs: 1000,
    });
    expect(line.startsWith('Tests:')).toBe(true);
  });

  it('keeps the words "passed", "failed", "skipped" uncolored', () => {
    const line = formatTestSummary({
      testStatus: [
        { id: '1', status: 'pass' },
        { id: '2', status: 'fail' },
      ],
      durationMs: 1000,
    });
    expect(line).toContain('passed');
    expect(line).toContain('failed');
    expect(/\x1b\[[0-9;]*m(passed|failed|skipped)/.test(line)).toBe(false);
    expect(/(passed|failed|skipped)\x1b\[[0-9;]*m/.test(line)).toBe(false);
  });

  it('colors the passed count green', () => {
    const line = formatTestSummary({
      testStatus: [{ id: '1', status: 'pass' }],
      durationMs: 1000,
    });
    expect(line).toMatch(/\x1b\[32m1\x1b\[0m passed/);
  });

  it('colors the failed count red only when > 0', () => {
    const lineWithFailures = formatTestSummary({
      testStatus: [
        { id: '1', status: 'pass' },
        { id: '2', status: 'fail' },
      ],
      durationMs: 1000,
    });
    expect(lineWithFailures).toMatch(/\x1b\[31m1\x1b\[0m failed/);

    const lineNoFailures = formatTestSummary({
      testStatus: [{ id: '1', status: 'pass' }],
      durationMs: 1000,
    });
    expect(lineNoFailures).not.toMatch(/\x1b\[31m0\x1b\[0m failed/);
    expect(lineNoFailures).toContain('0 failed');
  });

  it('colors the skipped count yellow only when > 0', () => {
    const lineWithSkips = formatTestSummary({
      testStatus: [
        { id: '1', status: 'pass' },
        { id: '2', status: 'skip' },
      ],
      durationMs: 1000,
    });
    expect(lineWithSkips).toMatch(/\x1b\[33m1\x1b\[0m skipped/);

    const lineNoSkips = formatTestSummary({
      testStatus: [{ id: '1', status: 'pass' }],
      durationMs: 1000,
    });
    expect(lineNoSkips).not.toMatch(/\x1b\[33m0\x1b\[0m skipped/);
    expect(lineNoSkips).toContain('0 skipped');
  });
});

describe('formatFailedTestsBlock', () => {
  it('returns null when there are no failures', () => {
    const block = formatFailedTestsBlock({
      testStatus: [{ id: '1', status: 'pass' }],
      handlers: [{ id: '1', name: 'test1', type: 'test' }],
    });
    expect(block).toBeNull();
  });

  it('returns null on an empty run', () => {
    expect(formatFailedTestsBlock({ testStatus: [], handlers: [] })).toBeNull();
  });

  it('lists each failed test by name', () => {
    const block = formatFailedTestsBlock({
      testStatus: [
        { id: '1', status: 'pass' },
        { id: '2', status: 'fail', error: 'boom' },
        { id: '3', status: 'fail', error: 'kaboom' },
      ],
      handlers: [
        { id: '1', name: 'should render', type: 'test' },
        { id: '2', name: 'should submit form', type: 'test' },
        { id: '3', name: 'should show error', type: 'test' },
      ],
    });
    const stripped = stripAnsi(block);
    expect(stripped).toContain('Failed tests:');
    expect(stripped).toContain('should submit form');
    expect(stripped).toContain('should show error');
    expect(stripped.indexOf('should submit form')).toBeLessThan(stripped.indexOf('should show error'));
  });

  it('falls back to the test id when no matching handler is found', () => {
    const block = formatFailedTestsBlock({
      testStatus: [{ id: 'ghost-id', status: 'fail', error: 'boom' }],
      handlers: [],
    });
    expect(stripAnsi(block)).toContain('ghost-id');
  });
});
