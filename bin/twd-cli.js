#!/usr/bin/env node

// runTests and runMerge are imported inside their branches, not here. A static
// import of src/index.js pulls in puppeteer, so `twd-cli merge` — which never
// opens a browser — would otherwise load the whole browser-automation graph
// before it even looked at argv. The help paths below return for the same
// reason: `run --help` used to run the entire suite.
import { parseRunArgs, parseMergeArgs } from '../src/parseArgs.js';
import { globalUsage, runUsage, mergeUsage } from '../src/usage.js';

const [command, ...args] = process.argv.slice(2);

const USAGE = { run: runUsage, merge: mergeUsage };
const isHelp = (token) => token === '--help' || token === '-h';

// Help is decided here, before either parser runs and before any dynamic
// import, so asking for it never reads a config, touches git or launches a
// browser. Success text goes to stdout with exit 0; the process is left to
// drain rather than exited, so a piped stdout cannot truncate it.
if (command === undefined || command === 'help' || isHelp(command)) {
  const topic = command === 'help' ? args[0] : undefined;
  console.log((USAGE[topic] ?? globalUsage)());
} else if (USAGE[command] && args.some(isHelp)) {
  console.log(USAGE[command]());
} else if (command === 'run') {
  try {
    const { testFilters, changedSince, record, shard, reportDir, updateSnapshots, ci } =
      parseRunArgs(args);
    const { runTests } = await import('../src/index.js');
    const hasFailures = await runTests({
      testFilters,
      changedSince,
      recordOverrides: record,
      shard,
      reportDir,
      updateSnapshots,
      ci,
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
    const { dir, out } = parseMergeArgs(args);
    const { runMerge } = await import('../src/mergeCommand.js');
    const hasFailures = runMerge({ dir, out });
    process.exit(hasFailures ? 1 : 0);
  } catch (error) {
    if (!error?.reported) {
      console.error(error?.message ?? String(error));
    }
    process.exit(1);
  }
} else {
  // A command we do not know is a usage error, so it belongs on stderr with
  // exit 1. Printing it on stdout, as this used to, let a script mistake the
  // usage block for a successful run's output.
  console.error(`twd-cli: unknown command '${command}'`);
  console.error(globalUsage());
  process.exitCode = 1;
}
