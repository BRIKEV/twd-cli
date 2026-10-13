import { buildTestPath } from './buildTestPath.js';

// A positive integer, the same rule for `--repeat 5` and `--repeat=5`.
// Throws, like --shard and --cpu-throttle: a dropped value would be a single
// run the caller believes was repeated.
export function parseRepeat(value) {
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return Number(value);

  const got = value === undefined ? 'nothing' : JSON.stringify(value);
  throw new Error(`Invalid --repeat: expected a positive integer, got ${got}.`);
}

// A test that failed at least one round and passed at least one. A test that
// failed every round is a failure, not a flake.
export function isFlaky(test) {
  const runs = test.runs ?? 0;
  const passes = test.passes ?? 0;
  const skips = test.skips ?? 0;
  return passes > 0 && runs - passes - skips > 0;
}

// Fold one round into tallies keyed by registration index.
//
// twd-js mints test ids with Math.random() at registration, so a reload cannot
// be joined on id. Registration order is stable across loads — the same
// assumption sharding's fingerprint makes — so the index in this round's
// ordered id list is the identity. `handlers` are this round's, and the path
// is stored now because a later round's handler map will not contain this id.
export function recordRound(tally, orderedIds, results, handlers) {
  const indexById = new Map(orderedIds.map((id, index) => [id, index]));
  const seen = new Set();
  for (const result of results) {
    if (seen.has(result.id)) continue;
    seen.add(result.id);
    const index = indexById.get(result.id);
    if (index === undefined) continue;

    const row = tally.get(index) ?? {
      index,
      id: result.id,
      runs: 0,
      passes: 0,
      skips: 0,
      path: null,
    };
    row.id = result.id;
    row.runs += 1;
    if (result.status === 'pass') row.passes += 1;
    else if (result.status === 'skip') row.skips += 1;
    else if (result.status === 'fail') {
      row.error = result.error;
      if (result.diagnostics !== undefined) row.diagnostics = result.diagnostics;
    }
    const failures = row.runs - row.passes - row.skips;
    if (failures > 0) row.status = 'fail';
    else if (row.passes > 0) row.status = 'pass';
    else row.status = 'skip';
    row.path = buildTestPath(result.id, handlers) ?? row.path;
    tally.set(index, row);
  }
}

// Tests that have failed at least once. A further failed round of the same
// test does not add another, which is what keeps --repeat from tripping
// maxFailures on the test it is measuring.
export function failedTestCount(tally) {
  let count = 0;
  for (const row of tally.values()) if (row.status === 'fail') count += 1;
  return count;
}

export function tallyToStatus(tally) {
  return [...tally.values()]
    .sort((a, b) => a.index - b.index)
    .map((row) => {
      const entry = {
        id: row.id,
        status: row.status,
        runs: row.runs,
        passes: row.passes,
        skips: row.skips,
        path: row.path,
        index: row.index,
      };
      if (row.error !== undefined) entry.error = row.error;
      if (row.diagnostics !== undefined) entry.diagnostics = row.diagnostics;
      return entry;
    });
}
