import fs from 'fs';
import path from 'path';
import { loadConfig } from './config.js';
import {
  readShardReports,
  readShardCoverage,
  DEFAULT_MERGED_OUT,
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

  const merged = mergeRunReports(found.map((f) => f.report));

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

  const outPath = path.resolve(workingDir, out ?? DEFAULT_MERGED_OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`Merged report written to ${outPath}`);

  let hasFailures = merged.tests.some((test) => test.status === 'fail');

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
      const reportPath = path.resolve(workingDir, config.contractReportPath);
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, generateContractMarkdown(validationOutput));
      console.log(`Contract report written to ${config.contractReportPath}`);
    }
  }

  // A red run yields no coverage — the same policy a single run has always had,
  // but keyed on the whole merged result instead of one shard's.
  if (config.coverage) {
    const coverages = found.map((f) =>
      readShardCoverage(f.dir, f.report.shards[0]?.coverageFile ?? null)
    );
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
      `${totals.notRun} not run != ${merged.discovery.totalTests} discovered. ` +
      'This points at a shard-slicing bug, not at your tests.'
    );
  }

  const timings = reportTimings(merged);
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
  }));

  return hasFailures;
}
