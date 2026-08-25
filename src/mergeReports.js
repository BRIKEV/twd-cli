import { REPORT_SCHEMA_VERSION } from './runReport.js';

/**
 * Combines shard reports into one report of the same shape.
 *
 * Only *consistency* is validated here — the things that stay true under a
 * partial merge. Completeness (is 1..total all present?) is checked by
 * findMissingShards, called from the merge command, because a 2-of-3 merge is a
 * legal intermediate value: rejecting it here would make
 * mergeRunReports([mergeRunReports([a, b]), c]) throw and destroy
 * associativity, which is the property that proves no test is lost or doubled.
 */
export function mergeRunReports(reports) {
  if (!reports.length) {
    throw new Error(
      'No shard reports to merge. Expected <dir>/*/run.json or <dir>/run.json.'
    );
  }

  const versions = [...new Set(reports.map((r) => r.schemaVersion))];
  if (versions.length > 1) {
    throw new Error(
      `Shard reports disagree on schemaVersion (${versions.sort().join(', ')}). ` +
      'Every shard job must run the same twd-cli version.'
    );
  }

  // Agreement is not enough. Reports from a newer twd-cli agree with each other
  // and would be merged by an older binary against a schema it does not
  // understand — the exact silent mis-merge the field exists to prevent.
  if (versions[0] !== REPORT_SCHEMA_VERSION) {
    throw new Error(
      `Shard reports use report schema v${versions[0]}, but this twd-cli reads ` +
      `v${REPORT_SCHEMA_VERSION}. Every shard job and the merge job must run the ` +
      'same twd-cli version.'
    );
  }

  const fingerprints = new Set(reports.map((r) => r.discovery.fingerprint));
  if (fingerprints.size > 1) {
    throw new Error(
      'Shard reports discovered different test sets, so they cannot be merged. ' +
      'Either tests are registered conditionally (a feature flag, a date, ' +
      'Math.random), or the shard jobs did not build the same code.'
    );
  }

  const shards = reports.flatMap((r) => r.shards);

  const totals = [...new Set(shards.map((s) => s.total))];
  if (totals.length > 1) {
    throw new Error(
      `Shard reports disagree on shard total (${totals.sort((a, b) => a - b).join(', ')}). ` +
      'Every shard job must pass the same --shard total.'
    );
  }

  const byIndex = new Set();
  for (const shard of shards) {
    if (byIndex.has(shard.index)) {
      throw new Error(`Shard ${shard.index}/${shard.total} appears more than once.`);
    }
    byIndex.add(shard.index);
  }

  // Overlap is detected on tests[].index — the test's position in the discovered
  // order — not on tests[].id. twd-js ids are Math.random() per page load, so
  // every shard invents its own and an id-keyed check can never fire: it looked
  // like a guard while proving nothing. Position is deterministic, so it is a
  // real one. The path cannot be the key either: duplicate test names share a
  // path and may legally land in different shards.
  const tests = [];
  const positions = new Set();
  for (const report of reports) {
    for (const test of report.tests) {
      if (test.index != null) {
        if (positions.has(test.index)) {
          throw new Error(
            `Test "${test.path ?? test.id}" (position ${test.index}) appears in more ` +
            'than one shard — the shard slices overlap.'
          );
        }
        positions.add(test.index);
      }
      tests.push(test);
    }
  }

  const first = reports[0];

  return {
    schemaVersion: first.schemaVersion,
    // Copy before sorting: sort mutates, and the input reports are the caller's.
    shards: [...shards].sort((a, b) => a.index - b.index),
    discovery: first.discovery,
    selection: first.selection,
    // Only the first shard's map, and only its own ids resolve in it — twd-js
    // ids are per-page-load random. That is why every test carries its own
    // resolved `path` and renderers prefer it; this stays for the ids it can
    // still explain and for diagnostics. Taking the first is the documented
    // contract, pinned by a test.
    handlers: first.handlers,
    tests,
    contracts: {
      configured: first.contracts.configured,
      partial: reports.some((r) => r.contracts.partial),
      results: reports.flatMap((r) => r.contracts.results),
      skipped: reports.flatMap((r) => r.contracts.skipped),
    },
  };
}

/**
 * Shard indices in 1..total that no report accounted for.
 *
 * A gap almost always means a shard job died before uploading its artifact. It
 * must be loud: a silent 3-of-4 merge reads as a complete green run.
 */
export function findMissingShards(report) {
  const total = report.shards[0]?.total ?? 0;
  const present = new Set(report.shards.map((s) => s.index));
  const missing = [];
  for (let i = 1; i <= total; i++) {
    if (!present.has(i)) missing.push(i);
  }
  return missing;
}

/**
 * Wall clock (what the developer waited) and compute (what was paid for).
 *
 * Derived rather than stored, so the two can never drift out of agreement with
 * the per-shard timestamps they come from.
 */
export function reportTimings(report) {
  const starts = report.shards.map((s) => Date.parse(s.startedAt));
  const ends = report.shards.map((s) => Date.parse(s.endedAt));
  return {
    wallMs: Math.max(...ends) - Math.min(...starts),
    computeMs: report.shards.reduce((sum, s) => sum + s.durationMs, 0),
  };
}

/**
 * Executed and not-run totals, plus whether they account for every discovered
 * test. An inconsistent result points at a shard-math bug, not user error.
 */
export function reportTotals(report) {
  const executed = report.shards.reduce((sum, s) => sum + s.executed, 0);
  const notRun = report.shards.reduce((sum, s) => sum + s.notRun, 0);
  // Against the count the shards divided, not everything discovered. With
  // --test active those differ by every excluded test, and comparing to
  // discovery.totalTests reported a slicing bug on a correct run. The fallback
  // is unreachable for a v2 report; it only keeps a hand-built one from
  // comparing against undefined and always warning.
  const expected = report.selection?.selectedTests ?? report.discovery.totalTests;
  return {
    executed,
    notRun,
    expected,
    consistent: executed + notRun === expected,
  };
}
