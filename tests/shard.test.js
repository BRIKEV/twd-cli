import { describe, it, expect } from 'vitest';
import { parseShardSpec, selectShardIds } from '../src/shard.js';

describe('parseShardSpec', () => {
  it('parses <index>/<total>', () => {
    expect(parseShardSpec('2/4')).toEqual({ index: 2, total: 4 });
    expect(parseShardSpec('1/1')).toEqual({ index: 1, total: 1 });
    expect(parseShardSpec(' 3/4 ')).toEqual({ index: 3, total: 4 });
  });

  // Unlike --record-speed, a bad --shard must never be silently ignored: it
  // would run zero tests and exit 0, reading as a green build that tested
  // nothing.
  it('throws when the index exceeds the total', () => {
    expect(() => parseShardSpec('5/4')).toThrow(/between 1 and 4/);
  });

  it('throws on a zero or negative index', () => {
    expect(() => parseShardSpec('0/4')).toThrow(/between 1 and 4/);
    expect(() => parseShardSpec('-1/4')).toThrow(/Expected <index>\/<total>/);
  });

  it('throws on a zero total', () => {
    expect(() => parseShardSpec('2/0')).toThrow(/at least 1/);
  });

  it('throws on unparseable input', () => {
    for (const bad of ['abc', '', '2', '2/', '/4', '2.5/4', '2/4/6', undefined, null]) {
      expect(() => parseShardSpec(bad)).toThrow(/Expected <index>\/<total>/);
    }
  });

  it('names the offending value in the message', () => {
    expect(() => parseShardSpec('9/2')).toThrow(/"9\/2"/);
  });
});

describe('selectShardIds', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `t${i}`);

  it('takes every Nth id at its own offset', () => {
    expect(selectShardIds(ids, 1, 4)).toEqual(['t0', 't4', 't8']);
    expect(selectShardIds(ids, 2, 4)).toEqual(['t1', 't5', 't9']);
    expect(selectShardIds(ids, 4, 4)).toEqual(['t3', 't7', 't11']);
  });

  it('returns everything when total is 1', () => {
    expect(selectShardIds(ids, 1, 1)).toEqual(ids);
  });

  // 3 tests across 4 shards leaves the fourth with nothing. Legal, not an error.
  it('returns an empty slice when there are fewer ids than shards', () => {
    expect(selectShardIds(['a', 'b', 'c'], 4, 4)).toEqual([]);
    expect(selectShardIds([], 1, 4)).toEqual([]);
  });

  // The property that makes sharding trustworthy: nothing lost, nothing doubled.
  it('partitions the input — every id lands in exactly one shard', () => {
    const many = Array.from({ length: 37 }, (_, i) => `t${i}`);
    const total = 5;
    const slices = Array.from({ length: total }, (_, i) => selectShardIds(many, i + 1, total));
    const counts = new Map();
    for (const id of slices.flat()) counts.set(id, (counts.get(id) ?? 0) + 1);
    expect(counts.size).toBe(many.length);
    expect([...counts.values()]).toEqual(many.map(() => 1));
  });

  it('does not mutate its input', () => {
    const input = ['a', 'b', 'c'];
    selectShardIds(input, 1, 2);
    expect(input).toEqual(['a', 'b', 'c']);
  });
});
