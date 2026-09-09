import crypto from 'node:crypto';
import { buildTestPath } from './buildTestPath.js';

export const REPORT_SCHEMA_VERSION = 2;

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
}) {
  // Resolved here, in the shard that ran the tests, because this is the only
  // place the handler map is valid: ids are per-page-load random, so shard 2's
  // ids mean nothing in shard 1's handler map — and shard 1's map is the one a
  // merged report keeps.
  const orderedPaths = allTestIds.map((id) => buildTestPath(id, handlers));
  const positions = new Map(allTestIds.map((id, i) => [id, i]));
  const selectedIds = filteredIds ?? allTestIds;

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
        recordings,
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
    })),
    contracts: contracts ?? {
      configured: false,
      partial: false,
      results: [],
      skipped: [],
    },
  };
}
