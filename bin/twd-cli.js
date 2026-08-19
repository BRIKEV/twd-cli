#!/usr/bin/env node

import { runTests } from '../src/index.js';
import { parseRunArgs, parseMergeArgs } from '../src/parseArgs.js';
import { runMerge } from '../src/mergeCommand.js';

const command = process.argv[2];

if (command === 'run') {
  try {
    const { testFilters, record, shard, reportDir } = parseRunArgs(process.argv.slice(3));
    const hasFailures = await runTests({
      testFilters,
      recordOverrides: record,
      shard,
      reportDir,
    });
    process.exit(hasFailures ? 1 : 0);
  } catch (error) {
    if (!error?.reported) {
      console.error(error?.message ?? String(error));
    }
    process.exit(1);
  }
} else if (command === 'merge') {
  try {
    const { dir, out } = parseMergeArgs(process.argv.slice(3));
    const hasFailures = runMerge({ dir, out });
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
  npx twd-cli run --record         Record the run to a video file
  npx twd-cli run --shard 2/4      Run only this shard's slice of the suite
                                   and write a report to ./.twd/run
  npx twd-cli merge <dir>          Merge shard reports from <dir> into one
                                   report, and exit 1 if the whole run failed

Examples:
  npx twd-cli run --test "shows error"
  npx twd-cli run --test "Login" --test "Signup"
  npx twd-cli run --shard 2/4
  npx twd-cli merge .twd/shards

Options:
  --test "<name>"        Filter tests by "suite > test" path (repeatable, OR'd)
  --shard <i>/<n>        Run slice i of n. Each shard discovers the whole
                         suite and takes every nth test, so the test count
                         never has to be known in advance. Implies a report.
  --report-dir <path>    Where to write the shard report (default ./.twd/run)
  --out <path>           merge only: where to write the merged report
                         (default ./.twd/merged-run.json)
  --record               Record the run to a video file (requires ffmpeg)
  --record-dir <path>    Output directory (default ./twd-artifacts)
  --record-speed <n>     Playback speed, e.g. 0.5 for half speed
  --record-pace <ms>     Slow the run itself (default 300). 0 disables pacing

  These three only set values. Recording still has to be turned on with
  --record or "record": { "enabled": true } in twd.config.json.

  Create a twd.config.json file in your project root to customize settings.
  `);
  process.exit(command ? 1 : 0);
}
