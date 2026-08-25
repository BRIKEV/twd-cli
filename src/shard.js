// Parses a "<index>/<total>" shard spec, e.g. "2/4" for job 2 of 4.
//
// This throws where src/parseArgs.js silently ignores a malformed
// --record-speed, and the divergence is deliberate: "--shard 5/4" would select
// no tests and exit 0, which reads as a green build that tested nothing.
export function parseShardSpec(value) {
  const raw = typeof value === 'string' ? value.trim() : value;
  const match = /^(\d+)\/(\d+)$/.exec(String(raw ?? ''));
  if (!match) {
    throw new Error(
      `Invalid --shard "${value}". Expected <index>/<total>, e.g. --shard 2/4.`
    );
  }

  const index = Number(match[1]);
  const total = Number(match[2]);

  if (total < 1) {
    throw new Error(`Invalid --shard "${value}". Total must be at least 1.`);
  }
  if (index < 1 || index > total) {
    throw new Error(
      `Invalid --shard "${value}". Index must be between 1 and ${total}.`
    );
  }

  return { index, total };
}

// Round-robin slice of an ordered id list. `index` is 1-based.
//
// Round-robin rather than contiguous: it balances better when adjacent tests
// have similar cost, and nothing in twd-js requires a suite to run
// contiguously, so locality buys nothing. An empty result is a legal outcome —
// 3 tests across 4 shards leaves the fourth with nothing to run.
export function selectShardIds(ids, index, total) {
  return ids.filter((_, i) => i % total === index - 1);
}
