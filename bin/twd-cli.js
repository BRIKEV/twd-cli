#!/usr/bin/env node

import { runTests } from '../src/index.js';

const command = process.argv[2];

if (command === 'run') {
  try {
    const hasFailures = await runTests();
    process.exit(hasFailures ? 1 : 0);
  } catch (error) {
    process.exit(1);
  }
} else {
  console.log(`
twd-cli - Test runner for TWD tests

Usage:
  npx twd-cli run    Run all tests

Options:
  Create a twd.config.json file in your project root to customize settings.
  `);
  process.exit(command ? 1 : 0);
}
