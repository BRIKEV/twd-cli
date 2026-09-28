import crypto from 'node:crypto';
import { buildTestPath } from './buildTestPath.js';

export const REPORT_SCHEMA_VERSION = 3;

/**
 * Hash of the full ordered list of test *paths* plus any active --test filters.
 *
 * Round-robin sharding is correct only if every job enumerates an identical
 * test set in an identical order. That breaks silently if the app registers
 * tests conditionally — a feature flag, a date, Math.random — or if two shard
 * jobs did not build the same code: tests quietly never run and the build stays
 * green. Shards compare fingerprints at merge time so it becomes an error.
 *
 * Paths, not ids. twd-js mints test ids with `Math.random()` at registration
 * time, so the same test carries a different id on every page load — and every
 * shard boots its own browser. Hashing ids made the fingerprint a per-load
 * nonce that could never match, so `merge` rejected every correct multi-shard
 * run. A `"suite > test"` path is derived from names, so it is stable across
 * loads, and it is the same string `--test` already filters on. The check is
 * also strictly stronger this way: a conditionally-registered test still
 * changes the hash, because its path drops out of the ordered list.
 *
 * Filters are OR'd, so their order carries no meaning and is normalized away.
 */
export function fingerprintTests(orderedPaths, filters = []) {
  const payload = JSON.stringify({
    orderedPaths,
    filters: [...filters].sort(),
  });
  const digest = crypto.createHash('sha256').update(payload).digest('hex');
  return `sha256:${digest}`;
}

/**
 * Assembles the on-disk run report. Pure: no I/O, no clock reads.
 *
 * `shards` is an array even for a single run, because a merged report has the
 * same shape as a single-shard one. That is what makes merging associative and
 * lets one set of formatters render both.
 *
 * `startedAt` and `endedAt` are epoch milliseconds; the report stores ISO
 * strings plus the derived duration.
 *
 * `allTestIds` is the whole discovered suite in order; `filteredIds` is what
 * survived `--test` and therefore what the shards actually divide between them.
 * They are the same list when no filter is active.
 */
export function buildRunReport({
  shard,
  startedAt,
  endedAt,
  allTestIds,
  filteredIds = null,
  filters = [],
  handlers,
  tests,
  executed,
  notRun,
  stoppedEarly,
  coverageFile = null,
  recording = null,
  recordings = [],
  contracts = null,
  retryCount = 0,
  version = null,
  url = null,
  error = null,
  snapshots = [],
  recordingFailed = false,
  coverage = null,
}) {
  // Resolved here, in the shard that ran the tests, because this is the only
  // place the handler map is valid: ids are per-page-load random, so shard 2's
  // ids mean nothing in shard 1's handler map — and shard 1's map is the one a
  // merged report keeps.
  const orderedPaths = allTestIds.map((id) => buildTestPath(id, handlers));
  const positions = new Map(allTestIds.map((id, i) => [id, i]));
  const selectedIds = filteredIds ?? allTestIds;

  return finalizeReport({
    schemaVersion: REPORT_SCHEMA_VERSION,
    run: { twdCliVersion: version, url },
    error,
    snapshots,
    coverage,
    shards: [
      {
        index: shard.index,
        total: shard.total,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date(endedAt).toISOString(),
        durationMs: endedAt - startedAt,
        executed,
        notRun,
        // Merged reports do not record which shard ran a test, so the per-shard
        // breakdown line could not be rendered without this count.
        failed: tests.filter((t) => t.status === 'fail').length,
        stoppedEarly,
        coverageFile,
        recording,
        recordings,
        recordingFailed,
      },
    ],
    discovery: {
      totalTests: allTestIds.length,
      fingerprint: fingerprintTests(orderedPaths, filters),
    },
    // selectedTests is the count the shards divided, which is what
    // executed + notRun must add up to. Comparing against totalTests instead
    // reports a slicing bug on any correct `--test` + `--shard` run.
    selection: { filters: [...filters], selectedTests: selectedIds.length },
    handlers,
    tests: tests.map((test) => ({
      ...test,
      // For display. May be null if the handler somehow went missing, so every
      // renderer has to tolerate that.
      path: buildTestPath(test.id, handlers),
      // Identity. Position in the shard-independent ordered list is stable
      // across shards because registration order is deterministic, unlike the
      // random id. The path cannot serve as the key: two tests may share one
      // (duplicate names) and can legally land in different shards.
      index: positions.has(test.id) ? positions.get(test.id) : null,
      attempts: attemptsFor(test, retryCount),
    })),
    contracts: contracts ?? {
      configured: false,
      partial: false,
      results: [],
      skipped: [],
    },
  });
}

function attemptsFor(test, retryCount) {
  if (test.status === 'fail') return retryCount + 1;
  if (test.status === 'pass') return test.retryAttempt ?? 1;
  return 0;
}

export function contractCounts(contracts) {
  const counts = { passed: 0, errors: 0, warnings: 0, skipped: contracts.skipped?.length ?? 0 };
  for (const result of contracts.results ?? []) {
    const validation = result.validation ?? { valid: true, warnings: [] };
    if (!validation.valid) {
      if (result.mode === 'error') counts.errors++;
      else counts.warnings++;
    } else if (validation.warnings?.length) {
      counts.warnings++;
    } else {
      counts.passed++;
    }
  }
  return counts;
}

// Everything derived lives here, so a merged report is finalized by the same rule as a single run.
export function finalizeReport(report) {
  const count = (status) => report.tests.filter((t) => t.status === status).length;
  const contracts = contractCounts(report.contracts);
  const stoppedEarly = report.shards.some((s) => s.stoppedEarly);
  const summary = {
    passed: count('pass'),
    failed: count('fail'),
    skipped: count('skip'),
    notRun: report.shards.reduce((n, s) => n + s.notRun, 0),
    stoppedEarly,
    contracts,
  };

  let outcome = 'passed';
  if (report.error) outcome = 'interrupted';
  else if (summary.failed > 0 || contracts.errors > 0 || stoppedEarly || report.shards.some((s) => s.recordingFailed)) {
    outcome = 'failed';
  }

  const starts = report.shards.map((s) => Date.parse(s.startedAt));
  const ends = report.shards.map((s) => Date.parse(s.endedAt));
  const startedAt = Math.min(...starts);
  const endedAt = Math.max(...ends);

  return {
    ...report,
    outcome,
    summary,
    recordings: report.shards.flatMap((s) => s.recordings ?? []),
    run: {
      ...report.run,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      durationMs: endedAt - startedAt,
    },
  };
}
