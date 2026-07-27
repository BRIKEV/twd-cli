#!/usr/bin/env node

import { runTests } from '../src/index.js';
import { parseRunArgs } from '../src/parseArgs.js';

const command = process.argv[2];

if (command === 'run') {
  try {
    const { testFilters, record } = parseRunArgs(process.argv.slice(3));
    const hasFailures = await runTests({ testFilters, recordOverrides: record });
    process.exit(hasFailures ? 1 : 0);
  } catch (error) {
    if (!error?.reported) {
      console.error(error?.message ?? String(error));
    }
    process.exit(1);
  }
} else {
  console.log(`
twd-cli - Test runner for TWD tests

Usage:
  npx twd-cli run                  Run all tests
  npx twd-cli run --test "<name>"  Run only tests whose "suite > test" path
                                   contains <name> (case-insensitive).
                                   Repeatable; multiple --test values are OR'd.
  npx twd-cli run --record          Record the run to a video file

Examples:
  npx twd-cli run --test "shows error"
  npx twd-cli run --test "Login" --test "Signup"

Options:
  --test "<name>"        Filter tests by "suite > test" path (repeatable, OR'd)
  --record               Record the run to a video file (requires ffmpeg)
  --record-dir <path>    Output directory (default ./twd-artifacts)
  --record-speed <n>     Playback speed, e.g. 0.5 for half speed

  --record-dir and --record-speed only set values. Recording still has to be
  turned on with --record or "record": { "enabled": true } in twd.config.json.

  Create a twd.config.json file in your project root to customize settings.
  `);
  process.exit(command ? 1 : 0);
}
