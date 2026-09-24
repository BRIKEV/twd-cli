import { parseShardSpec } from './shard.js';

// Every flag each parser recognises. src/usage.js has to describe all of
// them, and tests/usage.test.js checks that it does.
export const RUN_FLAGS = [
  '--test',
  '--changed-since',
  '--shard',
  '--report-dir',
  '--update-snapshots',
  '--ci',
  '--record',
  '--record-dir',
  '--record-speed',
  '--record-pace',
];

export const MERGE_FLAGS = ['--out'];

// Reads a flag's value in either `--flag value` or `--flag=value` form, and
// reports how many tokens it consumed. Shared by both parsers.
function readValue(argv, token, prefix, index) {
  if (token === prefix) {
    const next = argv[index + 1];
    // A value never starts with `--`. Taking one would consume the flag that
    // follows as well as producing a value nothing can resolve. The `=` form
    // stays available for the pathological case.
    if (next === undefined || next.startsWith('--')) return { value: undefined, consumed: 1 };
    return { value: next, consumed: 2 };
  }
  return { value: token.slice(prefix.length + 1), consumed: 1 };
}

// Levenshtein distance. Inputs are flag names, so the plain O(n*m) table.
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

// The known flag a typo most likely meant, or null. A prefix relation wins
// (`--output` → `--out`, `--test-filter` → `--test`), longest match first;
// otherwise the nearest flag within two edits (`--tests`, `--changed_since`).
// A wrong pick costs nothing, since the error already names the offending
// token, but `--out` must not turn into "Did you mean --ci?" — hence the
// tight edit budget rather than a generous one.
function closestFlag(name, known) {
  if (name.length >= 4) {
    const related = known
      .filter((flag) => flag.startsWith(name) || name.startsWith(flag))
      .sort((a, b) => b.length - a.length);
    if (related.length) return related[0];
  }
  let best = null;
  let bestDistance = Infinity;
  for (const flag of known) {
    const distance = editDistance(name, flag);
    if (distance < bestDistance) {
      best = flag;
      bestDistance = distance;
    }
  }
  return bestDistance <= 2 ? best : null;
}

// Every `--`-prefixed token no branch claimed ends up here, and the parser
// throws rather than run. This is what makes --help reliable instead of
// cosmetic: it used to be that `run --help` ran the whole suite because the
// unknown token was dropped without a word, and a typo like `--tests` still
// does the same today without this. The `=value` half is stripped so the
// message names the flag the caller typed, not the value they gave it.
function unknownOptionsError(command, tokens, known) {
  const names = tokens.map((token) => token.split('=')[0]);
  const suggestions = [...new Set(names.map((name) => closestFlag(name, known)).filter(Boolean))];
  const lines = [`twd-cli ${command}: unknown option ${names.join(', ')}`, ''];
  if (suggestions.length) lines.push(`Did you mean ${suggestions.join(', ')}?`);
  lines.push(`Run \`twd-cli ${command} --help\` to see every option.`);
  return new Error(lines.join('\n'));
}

export function parseRunArgs(argv) {
  const testFilters = [];
  const record = {};
  let shard = null;
  let reportDir = null;
  let changedSince = null;
  // Two separate flags on purpose, the way Jest separates them. They close two
  // different holes: --update-snapshots rewrites references that already exist,
  // --ci forbids creating one that does not. The precedence between them is
  // decided in twd-js, which is the only side that has fetched the reference.
  let updateSnapshots = false;
  let ci = false;
  const unknown = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (token === '--test' || token.startsWith('--test=')) {
      const { value, consumed } = readValue(argv, token, '--test', i);
      if (value !== undefined) testFilters.push(value);
      i += consumed - 1;
    } else if (token === '--shard' || token.startsWith('--shard=')) {
      const { value, consumed } = readValue(argv, token, '--shard', i);
      // Throws on a malformed spec. A silently-ignored --shard would run zero
      // tests and exit 0.
      shard = parseShardSpec(value);
      i += consumed - 1;
    } else if (token === '--changed-since' || token.startsWith('--changed-since=')) {
      const { value, consumed } = readValue(argv, token, '--changed-since', i);
      if (value !== undefined) changedSince = value;
      i += consumed - 1;
    } else if (token === '--report-dir' || token.startsWith('--report-dir=')) {
      const { value, consumed } = readValue(argv, token, '--report-dir', i);
      if (value !== undefined) reportDir = value;
      i += consumed - 1;
    } else if (token === '--update-snapshots') {
      updateSnapshots = true;
    } else if (token === '--ci') {
      ci = true;
    } else if (token === '--record') {
      record.enabled = true;
    } else if (token === '--record-dir' || token.startsWith('--record-dir=')) {
      const { value, consumed } = readValue(argv, token, '--record-dir', i);
      if (value !== undefined) record.dir = value;
      i += consumed - 1;
    } else if (token === '--record-speed' || token.startsWith('--record-speed=')) {
      const { value, consumed } = readValue(argv, token, '--record-speed', i);
      const parsed = Number(value);
      if (value !== undefined && Number.isFinite(parsed) && parsed > 0) {
        record.speed = parsed;
      }
      i += consumed - 1;
    } else if (token === '--record-pace' || token.startsWith('--record-pace=')) {
      const { value, consumed } = readValue(argv, token, '--record-pace', i);
      const parsed = Number(value);
      // `>= 0`, unlike --record-speed above. 0 is a meaningful pace — it is the
      // documented way to turn pacing off — where a speed of 0 is meaningless.
      // Rejecting it here left the flag a silent no-op that fell back to the
      // 300ms default, while the same value set in twd.config.json worked.
      if (value !== undefined && Number.isFinite(parsed) && parsed >= 0) {
        record.pace = parsed;
      }
      i += consumed - 1;
    } else if (token.startsWith('--')) {
      unknown.push(token);
    }
  }

  if (unknown.length) throw unknownOptionsError('run', unknown, RUN_FLAGS);

  return { testFilters, changedSince, record, shard, reportDir, updateSnapshots, ci };
}

// `twd-cli merge <dir> [--out <path>]`. The directory is the first positional
// token; further positionals are ignored, `--`-prefixed strays are refused.
export function parseMergeArgs(argv) {
  let dir = null;
  let out = null;
  const unknown = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (token === '--out' || token.startsWith('--out=')) {
      const { value, consumed } = readValue(argv, token, '--out', i);
      if (value !== undefined) out = value;
      i += consumed - 1;
    } else if (token.startsWith('--')) {
      unknown.push(token);
    } else if (dir === null) {
      dir = token;
    }
  }

  if (unknown.length) throw unknownOptionsError('merge', unknown, MERGE_FLAGS);

  return { dir, out };
}
