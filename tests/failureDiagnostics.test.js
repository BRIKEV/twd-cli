import { describe, it, expect } from 'vitest';
import { formatFailureDiagnostics } from '../src/failureDiagnostics.js';

describe('formatFailureDiagnostics', () => {
  // The snapshot is absent on a passing test, on a test that failed one attempt
  // then passed on retry, and on every test run against a twd-js that predates
  // diagnostics. All three have to render nothing rather than throw.
  it('renders nothing when there is no snapshot', () => {
    expect(formatFailureDiagnostics(undefined)).toEqual([]);
    expect(formatFailureDiagnostics(null)).toEqual([]);
  });

  // "This test mocks nothing" is the default, not a diagnostic. twd-js omits
  // mockRules in that case and the block must not invent a `0/0` row.
  it('renders nothing when the test registered no mock rules', () => {
    expect(formatFailureDiagnostics({ location: '/checkout' })).toEqual([]);
  });

  it('renders a bare count when every rule was triggered', () => {
    expect(formatFailureDiagnostics({
      location: '/checkout',
      mockRules: { registered: 6, triggered: 6, untriggered: [] },
    })).toEqual(['mock rules  6/6 triggered']);
  });

  // One miss names itself. That single alias is usually the whole answer, so it
  // is worth the inline room.
  it('names the alias when exactly one rule was never requested', () => {
    expect(formatFailureDiagnostics({
      location: '/cg-1/settings/catalog',
      mockRules: { registered: 7, triggered: 6, untriggered: ['catalog'] },
    })).toEqual(['mock rules  6/7 triggered — catalog never requested']);
  });

  it('lists the aliases under a count when several were never requested', () => {
    expect(formatFailureDiagnostics({
      location: '/cg-1',
      mockRules: { registered: 7, triggered: 4, untriggered: ['catalog', 'profile', 'advisor'] },
    })).toEqual([
      'mock rules  4/7 triggered — 3 never requested',
      '            ✗ catalog',
      '            ✗ profile',
      '            ✗ advisor',
    ]);
  });

  // A page with fifteen mocks must not produce fifteen lines.
  it('caps the list at five and counts the remainder', () => {
    const untriggered = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(formatFailureDiagnostics({
      location: '/wide',
      mockRules: { registered: 9, triggered: 2, untriggered },
    })).toEqual([
      'mock rules  2/9 triggered — 7 never requested',
      '            ✗ a',
      '            ✗ b',
      '            ✗ c',
      '            ✗ d',
      '            ✗ e',
      '            +2 more',
    ]);
  });

  it('shows no remainder line when the list lands exactly on the cap', () => {
    const lines = formatFailureDiagnostics({
      location: '/exact',
      mockRules: { registered: 5, triggered: 0, untriggered: ['a', 'b', 'c', 'd', 'e'] },
    });
    expect(lines).toHaveLength(6);
    expect(lines.some((l) => l.includes('more'))).toBe(false);
  });

  // A snapshot from a future twd-js that stops sending the array must not throw
  // in the middle of reporting a failure.
  it('tolerates a missing untriggered array', () => {
    expect(formatFailureDiagnostics({
      location: '/partial',
      mockRules: { registered: 3, triggered: 3 },
    })).toEqual(['mock rules  3/3 triggered']);
  });

  // The location row is deliberately not rendered: the failure message already
  // ends in `(at <href>)`, which is strictly more informative.
  it('never renders a location row', () => {
    const lines = formatFailureDiagnostics({
      location: '/cg-1/settings/catalog',
      mockRules: { registered: 2, triggered: 1, untriggered: ['catalog'] },
    });
    expect(lines.join('\n')).not.toContain('/cg-1/settings/catalog');
    expect(lines.join('\n')).not.toContain('location');
  });
});
