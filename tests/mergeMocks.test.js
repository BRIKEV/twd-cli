import { describe, it, expect } from 'vitest';
import { mergeMocks } from '../src/mergeMocks.js';

describe('mergeMocks', () => {
  it('returns an empty map when given an array of empty maps', () => {
    const merged = mergeMocks([new Map(), new Map()]);
    expect(merged.size).toBe(0);
  });

  it('prefixes entries from a single worker with w0:', () => {
    const w0 = new Map([
      ['GET:/api/a:200:t1:1', { alias: 'a', testId: 't1' }],
    ]);
    const merged = mergeMocks([w0, new Map()]);
    expect(merged.size).toBe(1);
    expect(merged.has('w0:GET:/api/a:200:t1:1')).toBe(true);
  });

  it('preserves entries from both workers with disjoint keys', () => {
    const w0 = new Map([['GET:/a:200:t1:1', { alias: 'a', testId: 't1' }]]);
    const w1 = new Map([['GET:/b:200:t2:1', { alias: 'b', testId: 't2' }]]);
    const merged = mergeMocks([w0, w1]);
    expect(merged.size).toBe(2);
    expect(merged.has('w0:GET:/a:200:t1:1')).toBe(true);
    expect(merged.has('w1:GET:/b:200:t2:1')).toBe(true);
  });

  it('keeps both entries when two workers happen to use the same inner key', () => {
    // Defense-in-depth: twd-js random IDs could collide; the prefix must
    // prevent one worker from overwriting the other's mock.
    const sharedInnerKey = 'GET:/api/users:200:same-id:1';
    const w0 = new Map([[sharedInnerKey, { alias: 'users', testId: 'same-id', from: 0 }]]);
    const w1 = new Map([[sharedInnerKey, { alias: 'users', testId: 'same-id', from: 1 }]]);
    const merged = mergeMocks([w0, w1]);
    expect(merged.size).toBe(2);
    expect(merged.get(`w0:${sharedInnerKey}`).from).toBe(0);
    expect(merged.get(`w1:${sharedInnerKey}`).from).toBe(1);
  });

  it('attaches workerIndex to each merged mock', () => {
    const w0 = new Map([['k', { alias: 'a' }]]);
    const w1 = new Map([['k', { alias: 'a' }]]);
    const merged = mergeMocks([w0, w1]);
    expect(merged.get('w0:k').workerIndex).toBe(0);
    expect(merged.get('w1:k').workerIndex).toBe(1);
  });
});
