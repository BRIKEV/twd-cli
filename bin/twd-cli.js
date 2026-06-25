#!/usr/bin/env node

import { runTests } from '../src/index.js';
import { parseRunArgs } from '../src/parseArgs.js';

const command = process.argv[2];

if (command === 'run') {
  try {
    const { testFilters } = parseRunArgs(process.argv.slice(3));
    const hasFailures = await runTests({ testFilters });
    process.exit(hasFailures ? 1 : 0);
  } catch (error) {
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

Examples:
  npx twd-cli run --test "shows error"
  npx twd-cli run --test "Login" --test "Signup"

Options:
  Create a twd.config.json file in your project root to customize settings.
  `);
  process.exit(command ? 1 : 0);
}
