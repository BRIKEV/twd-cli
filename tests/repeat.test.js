import { describe, it, expect } from 'vitest';
import { parseRepeat, recordRound, failedTestCount, tallyToStatus, isFlaky } from '../src/repeat.js';

describe('parseRepeat', () => {
  it('accepts a positive integer string', () => {
    expect(parseRepeat('5')).toBe(5);
    expect(parseRepeat('1')).toBe(1);
  });

  it('rejects zero, fractions, and junk', () => {
    expect(() => parseRepeat('0')).toThrow(/Invalid --repeat: expected a positive integer, got "0"/);
    expect(() => parseRepeat('1.5')).toThrow(/got "1.5"/);
    expect(() => parseRepeat('-2')).toThrow(/got "-2"/);
    expect(() => parseRepeat('nope')).toThrow(/got "nope"/);
    expect(() => parseRepeat(undefined)).toThrow(/got nothing/);
  });
});

describe('recordRound', () => {
  const handlersFor = (id, suiteId = 's') => [
    { id: suiteId, name: 'Checkout', type: 'suite' },
    { id, name: 'checkout flow', parent: suiteId, type: 'test' },
  ];

  it('counts passes and failures of the same test across reloads', () => {
    const tally = new Map();
    recordRound(tally, ['a'], [{ id: 'a', status: 'pass' }], handlersFor('a', 's1'));
    recordRound(
      tally,
      ['b'],
      [{ id: 'b', status: 'fail', error: 'total mismatch', diagnostics: { mock: true } }],
      handlersFor('b', 's2'),
    );

    const [row] = tallyToStatus(tally);
    expect(row).toMatchObject({
      id: 'b',
      status: 'fail',
      runs: 2,
      passes: 1,
      skips: 0,
      error: 'total mismatch',
      path: 'Checkout > checkout flow',
      index: 0,
    });
    expect(row.diagnostics).toEqual({ mock: true });
    expect(isFlaky(row)).toBe(true);
    expect(failedTestCount(tally)).toBe(1);
  });

  it('does not count a second result for the same id in one round', () => {
    const tally = new Map();
    recordRound(tally, ['a'], [
      { id: 'a', status: 'pass' },
      { id: 'a', status: 'fail', error: 'dup' },
    ], handlersFor('a'));
    expect(tallyToStatus(tally)[0]).toMatchObject({ runs: 1, passes: 1, status: 'pass' });
  });

  it('keeps a test that failed every round as a failure with no passes', () => {
    const tally = new Map();
    const handlers = [{ id: 'a', name: 't', type: 'test' }];
    recordRound(tally, ['a'], [{ id: 'a', status: 'fail', error: 'x' }], handlers);
    recordRound(tally, ['a'], [{ id: 'a', status: 'fail', error: 'y' }], handlers);
    const [row] = tallyToStatus(tally);
    expect(row).toMatchObject({ runs: 2, passes: 0, status: 'fail', error: 'y' });
    expect(isFlaky(row)).toBe(false);
  });

  it('counts a skip separately from a failure', () => {
    const tally = new Map();
    const handlers = [{ id: 'a', name: 't', type: 'test' }];
    recordRound(tally, ['a'], [{ id: 'a', status: 'skip' }], handlers);
    recordRound(tally, ['a'], [{ id: 'a', status: 'pass' }], handlers);
    expect(tallyToStatus(tally)[0]).toMatchObject({ runs: 2, passes: 1, skips: 1, status: 'pass' });
    expect(failedTestCount(tally)).toBe(0);
  });

  it('counts distinct failed tests, not failed rounds', () => {
    const tally = new Map();
    const handlers = [
      { id: 'a', name: 'one', type: 'test' },
      { id: 'b', name: 'two', type: 'test' },
    ];
    recordRound(tally, ['a', 'b'], [
      { id: 'a', status: 'fail', error: 'x' },
      { id: 'b', status: 'pass' },
    ], handlers);
    recordRound(tally, ['a', 'b'], [
      { id: 'a', status: 'fail', error: 'x' },
      { id: 'b', status: 'pass' },
    ], handlers);
    expect(failedTestCount(tally)).toBe(1);
  });
});
