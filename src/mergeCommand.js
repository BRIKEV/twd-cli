import fs from 'fs';
import path from 'path';
import { loadConfig } from './config.js';
import {
  readShardReports, readShardCoverage, cleanReportDir, writeReportFolder,
  rebaseShardArtifacts, DEFAULT_REPORT_DIR, HTML_FILE,
} from './reportFiles.js';
import {
  mergeRunReports,
  findMissingShards,
  reportTimings,
  reportTotals,
} from './mergeReports.js';
import { mergeCoverage } from './mergeCoverage.js';
import { formatRunComplete } from './testSummary.js';
import { printContractReport } from './contractReport.js';
import { generateContractMarkdown } from './contractMarkdown.js';

/**
 * Joins per-shard reports into one and reports on the whole run.
 *
 * This function owns the run's exit code. Shard jobs each exit 1 on their own
 * failures, so the workflow only reaches here with `if: !cancelled()`, and the
 * merged verdict is the one that counts.
 */
export function runMerge({ dir, out = null } = {}) {
  if (!dir) {
    throw new Error('Usage: twd-cli merge <dir> [--out <path>]');
  }

  const config = loadConfig();
  const workingDir = process.cwd();

  const found = readShardReports(dir);
  if (found.length === 0) {
    throw new Error(
      `No shard reports found in ${dir}. ` +
      'Expected <dir>/*/run.json (the actions/download-artifact layout) or <dir>/run.json.'
    );
  }

  // readShardReports returns readdir order, so twd-run-10 sorts before
  // twd-run-2. mergeRunReports sorts shards[] by index but concatenates tests
  // in argument order, so without this the merged report's tests and its shard
  // list disagree about ordering.
  found.sort((a, b) => (a.report.shards[0]?.index ?? 0) - (b.report.shards[0]?.index ?? 0));

  // A shard that never finished has no results worth merging, and its own error
  // explains the whole run better than a downstream "missing shard" message would.
  const interrupted = found.find((f) => f.report.outcome === 'interrupted');
  if (interrupted) {
    const s = interrupted.report.shards[0];
    throw new Error(
      `Shard ${s.index}/${s.total} was interrupted: ${interrupted.report.error?.message ?? 'unknown error'}. ` +
      'Its results are partial, so the run cannot be merged. Fix that shard and re-run it.'
    );
  }

  const outDir = path.resolve(workingDir, out ?? DEFAULT_REPORT_DIR);
  // Read everything before cleaning: out may be the folder the shards were read from.
  const coverages = found.map((f) => readShardCoverage(f.dir, f.report.shards[0]?.coverageFile ?? null));
  const rebased = found.map((f) => rebaseShardArtifacts(f.report, f.dir, `${outDir}.tmp-merge`, `shard-${f.report.shards[0].index}`));
  const merged = mergeRunReports(rebased);

  // Completeness is enforced here rather than inside mergeRunReports, which must
  // stay associative. A gap is never a warning: a silent 3-of-4 merge reads as a
  // complete green run.
  const missing = findMissingShards(merged);
  if (missing.length > 0) {
    const total = merged.shards[0].total;
    throw new Error(
      `Missing shard report(s): ${missing.map((i) => `${i}/${total}`).join(', ')}. ` +
      'A shard job likely failed before uploading its artifact — check that the ' +
      'upload step runs with `if: always()`.'
    );
  }

  cleanReportDir(outDir);
  fs.mkdirSync(outDir, { recursive: true });
  // Staged in a sibling folder: cleaning outDir could otherwise delete the very
  // shard files being copied, when out is the folder the shards were read from.
  if (fs.existsSync(`${outDir}.tmp-merge`)) {
    fs.cpSync(`${outDir}.tmp-merge`, outDir, { recursive: true, force: true });
    fs.rmSync(`${outDir}.tmp-merge`, { recursive: true, force: true });
  }

  let hasFailures = merged.outcome !== 'passed';

  if (merged.contracts.configured) {
    const validationOutput = {
      results: merged.contracts.results,
      skipped: merged.contracts.skipped,
    };
    if (printContractReport(validationOutput)) {
      hasFailures = true;
    }
    if (merged.contracts.partial) {
      console.warn(
        'Warning: contract data is partial — at least one shard stopped early, so ' +
        'some mocks were never collected.'
      );
    }
    if (config.contractReportPath) {
      console.warn('Warning: contractReportPath is deprecated and will be removed; the report folder\'s summary.md carries contract results.');
      const contractPath = path.resolve(workingDir, config.contractReportPath);
      fs.mkdirSync(path.dirname(contractPath), { recursive: true });
      fs.writeFileSync(contractPath, generateContractMarkdown(validationOutput));
      console.log(`Contract report written to ${config.contractReportPath}`);
    }
  }

  // A red run yields no coverage — the same policy a single run has always had,
  // but keyed on the whole merged result instead of one shard's.
  if (config.coverage) {
    const contributors = coverages.filter(Boolean).length;

    if (contributors === 0) {
      console.log('No coverage data found in any shard.');
    } else if (hasFailures) {
      console.log(
        `Skipping merged coverage — the run has failures ` +
        `(${contributors}/${found.length} shard(s) had data).`
      );
    } else {
      const nycDir = path.resolve(workingDir, config.nycOutputDir);
      fs.mkdirSync(nycDir, { recursive: true });
      fs.writeFileSync(path.join(nycDir, 'out.json'), JSON.stringify(mergeCoverage(coverages)));
      console.log(
        `Coverage merged from ${contributors}/${found.length} shards to ` +
        `${config.nycOutputDir}/out.json`
      );
    }
  }

  const totals = reportTotals(merged);
  if (!totals.consistent) {
    console.warn(
      `Warning: shard totals do not add up — ${totals.executed} executed + ` +
      `${totals.notRun} not run != ${totals.expected} selected. ` +
      'This points at a shard-slicing bug, not at your tests.'
    );
  }

  const timings = reportTimings(merged);

  let reportPath = null;
  try {
    writeReportFolder(outDir, merged, { formats: ['html', 'markdown'] });
    reportPath = path.relative(workingDir, path.join(outDir, HTML_FILE)).split(path.sep).join('/');
  } catch (err) {
    console.warn(`Warning: could not write the merged report: ${err.message}`);
  }

  console.log('');
  console.log(formatRunComplete({
    testStatus: merged.tests,
    handlers: merged.handlers,
    durationMs: timings.wallMs,
    computeMs: timings.computeMs,
    notRun: totals.notRun,
    shards: merged.shards,
    stoppedEarly: merged.shards.some((s) => s.stoppedEarly),
    maxFailures: config.maxFailures,
    reportPath,
  }));

  return hasFailures;
}
