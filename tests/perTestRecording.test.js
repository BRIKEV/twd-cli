import { describe, expect, it } from 'vitest';
import { resolvePerTestRecording } from '../src/perTestRecording.js';

describe('resolvePerTestRecording', () => {
  const base = { recording: true, testCount: 3, filename: null, maxClips: 20 };

  it('splits when several tests match', () => {
    expect(resolvePerTestRecording(base)).toEqual({ perTest: true, reason: null });
  });

  it('does not split when recording is off', () => {
    const result = resolvePerTestRecording({ ...base, recording: false });
    expect(result.perTest).toBe(false);
  });

  it('does not split a single test, which is already named after itself', () => {
    const result = resolvePerTestRecording({ ...base, testCount: 1 });
    expect(result.perTest).toBe(false);
    expect(result.reason).toBeNull();
  });

  it('does not split when an explicit filename was given', () => {
    const result = resolvePerTestRecording({ ...base, filename: 'demo.mp4' });
    expect(result.perTest).toBe(false);
    expect(result.reason).toMatch(/filename/i);
  });

  it('does not split past maxClips, and says how many', () => {
    const result = resolvePerTestRecording({ ...base, testCount: 21 });
    expect(result.perTest).toBe(false);
    expect(result.reason).toContain('21');
    expect(result.reason).toContain('20');
  });

  it('treats maxClips 0 as no limit', () => {
    const result = resolvePerTestRecording({ ...base, testCount: 500, maxClips: 0 });
    expect(result.perTest).toBe(true);
  });
});
