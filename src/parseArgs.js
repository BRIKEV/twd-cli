import { parseShardSpec } from './shard.js';

// Reads a flag's value in either `--flag value` or `--flag=value` form, and
// reports how many tokens it consumed. Shared by both parsers.
function readValue(argv, token, prefix, index) {
  if (token === prefix) {
    return { value: argv[index + 1], consumed: argv[index + 1] !== undefined ? 2 : 1 };
  }
  return { value: token.slice(prefix.length + 1), consumed: 1 };
}

export function parseRunArgs(argv) {
  const testFilters = [];
  const record = {};
  let shard = null;
  let reportDir = null;

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
    } else if (token === '--report-dir' || token.startsWith('--report-dir=')) {
      const { value, consumed } = readValue(argv, token, '--report-dir', i);
      if (value !== undefined) reportDir = value;
      i += consumed - 1;
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
      if (value !== undefined && Number.isFinite(parsed) && parsed > 0) {
        record.pace = parsed;
      }
      i += consumed - 1;
    }
  }

  return { testFilters, record, shard, reportDir };
}

// `twd-cli merge <dir> [--out <path>]`. The directory is the first positional
// token; anything after the first is ignored.
export function parseMergeArgs(argv) {
  let dir = null;
  let out = null;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (token === '--out' || token.startsWith('--out=')) {
      const { value, consumed } = readValue(argv, token, '--out', i);
      if (value !== undefined) out = value;
      i += consumed - 1;
    } else if (!token.startsWith('--') && dir === null) {
      dir = token;
    }
  }

  return { dir, out };
}
