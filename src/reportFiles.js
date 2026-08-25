import fs from 'fs';
import path from 'path';

export const DEFAULT_REPORT_DIR = './.twd/run';
export const DEFAULT_MERGED_OUT = './.twd/merged-run.json';
export const RUN_REPORT_FILE = 'run.json';
export const COVERAGE_FILE = 'coverage.json';

/**
 * Writes one shard's report, and its coverage when it collected any.
 *
 * The report is pretty-printed because a human reads it when a merge complains.
 * Coverage is not: it is machine input for nyc, routinely several megabytes, and
 * indenting it would roughly double the artifact size for no benefit.
 */
export function writeRunReport(dir, report, coverage = null) {
  fs.mkdirSync(dir, { recursive: true });

  const reportPath = path.join(dir, RUN_REPORT_FILE);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  let coveragePath = null;
  if (coverage) {
    coveragePath = path.join(dir, COVERAGE_FILE);
    fs.writeFileSync(coveragePath, JSON.stringify(coverage));
  }

  return { reportPath, coveragePath };
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
