#!/usr/bin/env node

import { runTests } from '../src/index.js';

const command = process.argv[2];

if (command === 'run') {
  try {
    await runTests();
  } catch (error) {
    console.error('Error running tests:', error);
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
