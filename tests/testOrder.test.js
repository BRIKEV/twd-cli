import { describe, it, expect } from 'vitest';
import { orderedTestIds, chunk } from '../src/testOrder.js';

describe('orderedTestIds', () => {
  it('returns test ids in enumeration order, skipping suites', () => {
    const handlers = [
      { id: 's1', type: 'suite' },
      { id: 't1', type: 'test', parent: 's1' },
      { id: 's2', type: 'suite', parent: 's1' },
      { id: 't2', type: 'test', parent: 's2' },
      { id: 't3', type: 'test', parent: 's1' },
    ];
    expect(orderedTestIds(handlers)).toEqual(['t1', 't2', 't3']);
  });

  it('returns an empty array when there are no tests', () => {
    expect(orderedTestIds([{ id: 's1', type: 'suite' }])).toEqual([]);
    expect(orderedTestIds([])).toEqual([]);
  });
});

describe('chunk', () => {
  it('splits into contiguous slices of the given size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns a single chunk when size <= 0', () => {
    expect(chunk([1, 2, 3], 0)).toEqual([[1, 2, 3]]);
    expect(chunk([1, 2, 3], -4)).toEqual([[1, 2, 3]]);
  });

  it('returns an empty array for empty input', () => {
    expect(chunk([], 10)).toEqual([]);
  });
});
