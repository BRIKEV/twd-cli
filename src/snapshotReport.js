import fs from 'node:fs';
import path from 'node:path';

export const SNAPSHOT_REPORT_FILE = 'snapshot-report.html';

const SUFFIX = '.failed.png';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Snapshot names come from test files, so they are author-controlled rather
// than hostile, but they land in markup and a stray `<` would silently break
// the page for everything after it.
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);

function render(failures, skipped) {
  const cards = failures
    .map(
      ({ name, dataUri }) => `    <section class="shot">
      <h2>${escapeHtml(name)}</h2>
      <img alt="Layout diff for ${escapeHtml(name)}" src="${dataUri}">
    </section>`
    )
    .join('\n');

  const skippedBlock = skipped.length
    ? `    <section class="skipped">
      <h2>Could not be read</h2>
      <p>These capture files exist but could not be opened, so they are not shown above.</p>
      <ul>${skipped.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>
    </section>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>TWD layout snapshot failures</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 24px; font: 14px/1.5 system-ui, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .lede { margin: 0 0 24px; opacity: 0.75; max-width: 60ch; }
  .shot { margin-bottom: 32px; }
  .shot h2 { font-size: 15px; font-family: ui-monospace, monospace; margin: 0 0 8px; }
  .shot img { max-width: 100%; height: auto; border: 1px solid rgba(128,128,128,0.4); }
  .legend { display: flex; gap: 16px; margin: 0 0 24px; padding: 0; list-style: none; opacity: 0.75; }
  .legend span { display: inline-block; width: 12px; height: 12px; margin-right: 6px; vertical-align: -1px; }
  .changed { background: rgba(255,0,0,0.3); border: 1px solid rgba(220,0,0,0.9); }
  .new-area { background: rgba(255,150,0,0.25); border: 1px solid rgba(220,120,0,0.9); }
  .skipped { opacity: 0.75; }
</style>
</head>
<body>
  <h1>Layout snapshot failures</h1>
  <p class="lede">
    Each capture below is the page as it rendered on this run, with the rows that
    diverged from the committed reference marked. The reference itself was not
    changed. Accept a change with <code>npx twd-cli run --update-snapshots</code>.
  </p>
  <ul class="legend">
    <li><span class="changed"></span>changed</li>
    <li><span class="new-area"></span>new area</li>
  </ul>
${cards}
${skippedBlock}
</body>
</html>
`;
}

/**
 * Deletes the `<name>.failed.png` captures left by earlier runs.
 *
 * Needed because twd-js overwrites a capture when a snapshot fails but never
 * removes one when that snapshot later passes. Without this sweep a fixed
 * layout keeps its old capture forever and the report shows a failure that no
 * longer exists, which is worse than having no report at all.
 *
 * Only ever touches files ending in `.failed.png` inside the configured
 * directory. The `.snap` references next to them are committed and are never
 * touched. Missing directory is a no-op.
 *
 * @returns the number of captures removed.
 */
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
      // A capture we cannot delete is not worth failing a run over. It will
      // show up in the report, which is the visible outcome anyway.
    }
  }
  return removed;
}

/**
 * Builds one self-contained HTML page from the `<name>.failed.png` captures a
 * run left behind, and writes it to `outDir`.
 *
 * Self-contained on purpose: the images go in as `data:` URIs so a CI job can
 * upload a single artifact and the reviewer opens one file, instead of
 * downloading a zip of loose PNGs and matching them up by filename. In CI the
 * machine that produced them is gone by the time anyone looks.
 *
 * Needs nothing from twd-js: the captures are already on disk and the snapshot
 * name is the filename minus the suffix.
 *
 * @returns `{ reportPath, count, skipped }`, or `null` when there was nothing to
 *   report or the file could not be written.
 */
export function writeSnapshotReport(snapshotDir, outDir) {
  let files;
  try {
    files = fs.readdirSync(snapshotDir).filter((f) => f.endsWith(SUFFIX)).sort();
  } catch {
    // No directory means no snapshot ever ran here. Not an error.
    return null;
  }

  if (files.length === 0) return null;

  const failures = [];
  const skipped = [];
  for (const file of files) {
    try {
      const bytes = fs.readFileSync(path.join(snapshotDir, file));
      failures.push({
        name: file.slice(0, -SUFFIX.length),
        dataUri: `data:image/png;base64,${bytes.toString('base64')}`,
      });
    } catch {
      // One unreadable file must not cost the reviewer the other nine.
      skipped.push(file);
    }
  }

  try {
    fs.mkdirSync(outDir, { recursive: true });
    const reportPath = path.join(outDir, SNAPSHOT_REPORT_FILE);
    fs.writeFileSync(reportPath, render(failures, skipped));
    return { reportPath, count: failures.length, skipped };
  } catch (error) {
    // The report is a diagnostic aid. Failing the run because it could not be
    // written would turn it into a new failure mode of its own.
    console.warn(`Warning: could not write the snapshot report: ${error.message}`);
    return null;
  }
}
