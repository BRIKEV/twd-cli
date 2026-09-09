/**
 * Splitting is the default when it is meaningful; this is the list of cases where
 * it is not. `reason` is null when nothing needs saying, and a printable sentence
 * when the run asked for something that had to be refused.
 */
export function resolvePerTestRecording({ recording, testCount, filename, maxClips }) {
  if (!recording || testCount <= 1) {
    return { perTest: false, reason: null };
  }

  if (filename) {
    return {
      perTest: false,
      reason: `Recording every test to ${filename}: one clip per test needs one name per test, and record.filename fixes a single name.`,
    };
  }

  // 0 disables the bound, matching how record.pace treats 0 as "off".
  if (maxClips > 0 && testCount > maxClips) {
    return {
      perTest: false,
      reason: `Recording ${testCount} test(s) to one file: past maxClips (${maxClips}), a clip per test is more clips than anyone opens.`,
    };
  }

  return { perTest: true, reason: null };
}
