import fs from 'fs';
import path from 'path';
import { REPORT_SCHEMA_VERSION } from './runReport.js';
import { renderHtml } from './reportHtml.js';
import { renderMarkdown } from './reportMarkdown.js';

export const DEFAULT_REPORT_DIR = './.twd/report';
export const RUN_REPORT_FILE = 'run.json';
export const COVERAGE_FILE = 'coverage.json';
export const HTML_FILE = 'index.html';
export const MARKDOWN_FILE = 'summary.md';
export const RECORDINGS_DIR = 'recordings';
export const SNAPSHOTS_DIR = 'snapshots';
export const OWNED_ENTRIES = [RUN_REPORT_FILE, COVERAGE_FILE, HTML_FILE, MARKDOWN_FILE, RECORDINGS_DIR, SNAPSHOTS_DIR];

const toPosix = (p) => p.split(path.sep).join('/');

// report.dir may be a folder the user cares about: never remove anything we did not create.
export function cleanReportDir(dir) {
  let names;
  try {
    // An auto-mocked fs (vi.mock('fs') in the test suite) returns undefined
    // rather than throwing or returning an array; treat that the same as an
    // empty directory instead of crashing on .includes below.
    names = fs.readdirSync(dir) ?? [];
  } catch {
    return;
  }
  // A folder this tool has never written a report into is not ours to clean,
  // even if it happens to hold files with the same names (a user's own
  // index.html, say). run.json is the marker that it has been a twd report
  // folder before.
  if (!names.includes(RUN_REPORT_FILE)) return;
  const entries = [...OWNED_ENTRIES];
  for (const name of names) if (/^shard-\d+$/.test(name)) entries.push(name);
  for (const name of entries) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
}

export function copySnapshotCaptures(captures, dir) {
  const copied = [];
  for (const capture of captures) {
    const file = toPosix(path.join(SNAPSHOTS_DIR, path.basename(capture.path)));
    try {
      fs.mkdirSync(path.join(dir, SNAPSHOTS_DIR), { recursive: true });
      fs.copyFileSync(capture.path, path.join(dir, file));
      copied.push({ name: capture.name, file });
    } catch {
      // Unreadable capture: the test failure still reports it.
    }
  }
  return copied;
}

export function loadSnapshotImages(dir, snapshots = []) {
  const images = {};
  for (const s of snapshots) {
    try {
      images[s.file] = `data:image/png;base64,${fs.readFileSync(path.join(dir, s.file)).toString('base64')}`;
    } catch {
      // Renderer shows "could not be read".
    }
  }
  return images;
}

export function writeReportFolder(dir, report, { formats = [], coverage = null } = {}) {
  fs.mkdirSync(dir, { recursive: true });

  const reportPath = path.join(dir, RUN_REPORT_FILE);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  // Coverage is machine input for nyc and often megabytes, so it is not indented.
  if (coverage) fs.writeFileSync(path.join(dir, COVERAGE_FILE), JSON.stringify(coverage));

  let htmlPath = null;
  if (formats.includes('html')) {
    htmlPath = path.join(dir, HTML_FILE);
    fs.writeFileSync(htmlPath, renderHtml(report, { images: loadSnapshotImages(dir, report.snapshots) }));
  }

  let markdownPath = null;
  if (formats.includes('markdown')) {
    markdownPath = path.join(dir, MARKDOWN_FILE);
    fs.writeFileSync(markdownPath, renderMarkdown(report));
  }

  return { reportPath, htmlPath, markdownPath };
}

export function readReport(input) {
  const file = input.endsWith('.json') ? input : path.join(input, RUN_REPORT_FILE);
  if (!fs.existsSync(file)) {
    throw new Error(`No report found at ${file}. Run \`twd-cli run\` first, or pass the report folder.`);
  }
  const report = readJson(file, RUN_REPORT_FILE);
  if (report.schemaVersion !== REPORT_SCHEMA_VERSION) {
    throw new Error(
      `Report at ${file} uses schema v${report.schemaVersion}, but this twd-cli reads v${REPORT_SCHEMA_VERSION}.`
    );
  }
  return { report, dir: path.dirname(file) };
}

// Shards all name their clip run.mp4, so a merged folder keeps each shard's files under its own prefix.
export function rebaseShardArtifacts(report, shardDir, outDir, prefix) {
  const moved = new Map();
  const move = (file) => {
    if (!file) return file;
    if (moved.has(file)) return moved.get(file);
    const target = toPosix(path.join(prefix, file));
    try {
      fs.mkdirSync(path.dirname(path.join(outDir, target)), { recursive: true });
      fs.copyFileSync(path.join(shardDir, file), path.join(outDir, target));
    } catch {
      // Missing artifact: keep the rewritten path; the HTML shows a broken link, not a wrong one.
    }
    moved.set(file, target);
    return target;
  };

  return {
    ...report,
    tests: report.tests.map((t) => (t.recording ? { ...t, recording: move(t.recording) } : t)),
    snapshots: (report.snapshots ?? []).map((s) => ({ ...s, file: move(s.file) })),
    shards: report.shards.map((s) => ({
      ...s,
      recording: s.recording ? { ...s.recording, file: move(s.recording.file) } : s.recording,
      recordings: (s.recordings ?? []).map((r) => ({ ...r, file: move(r.file) })),
    })),
  };
}

function readJson(file, label) {
  const raw = fs.readFileSync(file, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Could not parse ${label} at ${file}: ${err.message}`);
  }
}

/**
 * Finds every shard report under `dir`.
 *
 * actions/download-artifact lays each artifact out as its own directory, so the
 * normal shape is `<dir>/<artifact-name>/run.json`. A bare `<dir>/run.json` is
 * also accepted, which is what a local single-shard run produces.
 */
export function readShardReports(dir) {
  const found = [];

  const direct = path.join(dir, RUN_REPORT_FILE);
  if (fs.existsSync(direct)) {
    found.push({ dir, report: readJson(direct, RUN_REPORT_FILE) });
  }

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    // Missing or unreadable directory: the caller reports "no reports found",
    // which is a better message than an ENOENT stack.
    return found;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const shardDir = path.join(dir, entry.name);
    const file = path.join(shardDir, RUN_REPORT_FILE);
    if (fs.existsSync(file)) {
      found.push({ dir: shardDir, report: readJson(file, RUN_REPORT_FILE) });
    }
  }

  return found;
}

/**
 * Reads a shard's coverage, or null when it collected none.
 *
 * Absence is a normal outcome, not an error: a filtered run skips coverage
 * entirely. Merge reports how many shards contributed.
 */
export function readShardCoverage(shardDir, coverageFile) {
  if (!coverageFile) return null;
  const file = path.join(shardDir, coverageFile);
  if (!fs.existsSync(file)) return null;
  return readJson(file, COVERAGE_FILE);
}
