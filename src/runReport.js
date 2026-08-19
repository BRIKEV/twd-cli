import crypto from 'node:crypto';

export const REPORT_SCHEMA_VERSION = 1;

/**
 * Hash of the full ordered test id list plus any active --test filters.
 *
 * Round-robin sharding is correct only if every job enumerates an identical
 * test set in an identical order. That breaks silently if the app registers
 * tests conditionally — a feature flag, a date, Math.random — or if two shard
 * jobs did not build the same code: tests quietly never run and the build stays
 * green. Shards compare fingerprints at merge time so it becomes an error.
 *
 * Filters are OR'd, so their order carries no meaning and is normalized away.
 */
export function fingerprintTests(orderedIds, filters = []) {
  const payload = JSON.stringify({
    orderedIds,
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
 */
export function buildRunReport({
  shard,
  startedAt,
  endedAt,
  allTestIds,
  filters = [],
  handlers,
  tests,
  executed,
  notRun,
  stoppedEarly,
  coverageFile = null,
  recording = null,
  contracts = null,
}) {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
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
      },
    ],
    discovery: {
      totalTests: allTestIds.length,
      fingerprint: fingerprintTests(allTestIds, filters),
    },
    selection: { filters: [...filters] },
    handlers,
    tests,
    contracts: contracts ?? {
      configured: false,
      partial: false,
      results: [],
      skipped: [],
    },
  };
}
