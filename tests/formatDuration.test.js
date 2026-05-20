import { describe, it, expect } from 'vitest';
import { formatDuration } from '../src/formatDuration.js';

describe('formatDuration', () => {
  it('formats zero as 0:00.000', () => {
    expect(formatDuration(0)).toBe('0:00.000');
  });

  it('formats sub-second durations with leading zero minutes/seconds', () => {
    expect(formatDuration(123)).toBe('0:00.123');
  });

  it('formats single-digit seconds with a leading zero', () => {
    expect(formatDuration(5_678)).toBe('0:05.678');
  });

  it('formats the spec example (83.193s) as 1:23.193', () => {
    expect(formatDuration(83_193)).toBe('1:23.193');
  });

  it('formats a long duration past 10 minutes', () => {
    expect(formatDuration(754_567)).toBe('12:34.567');
  });

  it('pads milliseconds to three digits', () => {
    expect(formatDuration(60_007)).toBe('1:00.007');
  });
});
