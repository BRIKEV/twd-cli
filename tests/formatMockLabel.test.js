import { describe, it, expect } from 'vitest';
import { formatMockLabel } from '../src/formatMockLabel.js';

describe('formatMockLabel', () => {
  it('returns alias only when no testName and occurrence is 1', () => {
    expect(formatMockLabel({ alias: 'getPets', occurrence: 1 })).toBe('mock "getPets"');
  });

  it('returns alias with testName when occurrence is 1', () => {
    expect(formatMockLabel({ alias: 'getPets', occurrence: 1, testName: 'Cart > should load' }))
      .toBe('mock "getPets" — in "Cart > should load"');
  });

  it('returns alias with occurrence suffix when occurrence > 1', () => {
    expect(formatMockLabel({ alias: 'getPets', occurrence: 2 }))
      .toBe('mock "getPets" 2nd time');
  });

  it('returns alias with occurrence suffix and testName', () => {
    expect(formatMockLabel({ alias: 'getPets', occurrence: 2, testName: 'Cart > should load' }))
      .toBe('mock "getPets" 2nd time — in "Cart > should load"');
  });

  it('handles 3rd occurrence', () => {
    expect(formatMockLabel({ alias: 'getPets', occurrence: 3, testName: 'Cart > should load' }))
      .toBe('mock "getPets" 3rd time — in "Cart > should load"');
  });

  it('handles 4th+ occurrence with "th" suffix', () => {
    expect(formatMockLabel({ alias: 'getPets', occurrence: 4 }))
      .toBe('mock "getPets" 4th time');
  });

  it('handles missing occurrence (backward compat)', () => {
    expect(formatMockLabel({ alias: 'getPets' })).toBe('mock "getPets"');
  });
});
