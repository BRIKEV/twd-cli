import fs from 'node:fs';
import path from 'node:path';

const SUFFIX = '.failed.png';

// twd-js never deletes a capture when a snapshot later passes, so each run sweeps first.
export function clearFailureCaptures(snapshotDir) {
  let files;
  try {
    files = fs.readdirSync(snapshotDir).filter((f) => f.endsWith(SUFFIX));
  } catch {
    return 0;
  }
  let removed = 0;
  for (const file of files) {
    try {
      fs.rmSync(path.join(snapshotDir, file), { force: true });
      removed++;
    } catch {
      // Left in place; it shows up in the report.
    }
  }
  return removed;
}

export function listFailureCaptures(snapshotDir) {
  let files;
  try {
    files = fs.readdirSync(snapshotDir) ?? [];
  } catch {
    return [];
  }
  return files
    .filter((f) => f.endsWith(SUFFIX))
    .sort()
    .map((f) => ({ name: f.slice(0, -SUFFIX.length), path: path.join(snapshotDir, f) }));
}
