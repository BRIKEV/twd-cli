# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

twd-cli is a CLI tool for running TWD (Test While Developing) browser-based tests using Puppeteer in CI/CD environments. It's an npm package that launches a headless browser, navigates to a dev server, and executes tests registered via the `twd-js` framework.

## Commands

- `npm test` — Run tests in watch mode (vitest)
- `npm run test:ci` — Run tests once with V8 coverage
- `npm run execute:cli` — Run the CLI locally (`node ./bin/twd-cli.js`)
- `npm run lock:linux` — Regenerate package-lock.json inside a Linux node:24 container (Docker must be running). Required after dependency updates: npm on macOS never installs the wasm32-wasi optional packages, so it leaves their transitive deps (`@emnapi/*`) stale in the lock, which breaks `npm ci` on Linux CI.
- `npx twd-cli run` — Run TWD tests (the user-facing command)

## Architecture

The codebase is a small ESM-only Node.js CLI with two core source files:

**`bin/twd-cli.js`** — CLI entry point. Parses `process.argv` for the `run` command, calls `runTests()`, and exits with code 0 (pass) or 1 (failure).

**`src/config.js`** — `loadConfig()` reads `twd.config.json` from `process.cwd()`, merges it with defaults (url, timeout, coverage, headless, puppeteerArgs, retryCount, protocolTimeout), and returns the merged config. Falls back to defaults if the file is missing or unparseable.

`protocolTimeout` (default `300000`, 5 min) is passed to `puppeteer.launch` and bounds Puppeteer's CDP commands. It matters because the entire suite runs inside a single `page.evaluate` (`Runtime.callFunctionOn`), so Puppeteer's implicit 180000ms ceiling would abort long-but-passing suites with no per-test output. Raise it for slow CI; `0` means no timeout.

**`src/index.js`** — `runTests()` is the main orchestrator:
1. Loads config via `loadConfig()`
2. Launches Puppeteer with configured headless mode and args
3. Navigates to the configured URL (default: `http://localhost:5173`)
4. Waits for `#twd-sidebar-root` selector (indicates app + TWD are ready)
5. Calls `window.__testRunner` in the browser context to execute all tests
6. Prints a relay-style summary block (`formatRunComplete` in `src/testSummary.js`) as the last output: passed/failed/skipped counts, duration, failed tests with `suite > test` paths and error messages, and retried tests. Known infrastructure errors (dev server down, sidebar missing, protocol timeout, Chrome launch failure) get actionable diagnostics from `src/diagnostics.js`.
7. Optionally collects `window.__coverage__` and writes to `.nyc_output/out.json`
8. Returns boolean `hasFailures`

**`test-example-app/`** — A React demo app with TWD tests integrated, used for manual testing/demonstration. Not part of the published package or test suite.

## Testing

Tests are in `tests/` and use vitest. The test suite mocks `fs` to test config loading and mocks Puppeteer to test the run flow. Coverage is configured for `src/**/*.js` only.

## Key Dependencies

- **puppeteer** — Browser automation (launches Chrome/Chromium)
- **twd-js** — not a dependency of this package; the user's app bundles it, which provides the in-browser `__testRunner` and `#twd-sidebar-root` this CLI drives
