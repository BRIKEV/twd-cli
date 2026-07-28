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

The codebase is a small ESM-only Node.js CLI. `bin/twd-cli.js` and `src/index.js` are the spine; every other file in `src/` is a single-purpose helper with a matching `tests/*.test.js`.

**`bin/twd-cli.js`**: CLI entry point. Parses `process.argv` for the `run` command via `src/parseArgs.js`, calls `runTests()`, and exits with code 0 (pass) or 1 (failure).

**`src/parseArgs.js`**: `parseRunArgs(argv)` returns `{ testFilters, record }`. Supports `--test` (repeatable substring filter) and the recording flags `--record`, `--record-dir`, `--record-speed`. Each accepts both `--flag value` and `--flag=value`. The returned `record` object is passed to `runTests()` as `recordOverrides` and wins over the config file.

**`src/config.js`**: `loadConfig()` reads `twd.config.json` from `process.cwd()`, merges it with defaults (url, timeout, coverage, coverageDir, nycOutputDir, headless, puppeteerArgs, retryCount, protocolTimeout, maxFailures, chunkSize, record), and returns the merged config. Falls back to defaults if the file is missing or unparseable.

`protocolTimeout` (default `300000`, 5 min) is passed to `puppeteer.launch` and bounds each chunk's CDP call. `maxFailures` (default `10`) stops the run after that many cumulative test failures; set to `0` to disable. `chunkSize` (default `10`) controls how many tests run per browser call.

`record` (`DEFAULT_RECORD`) is the only **nested** config key, so the merge goes two levels deep: `record` merges over `DEFAULT_RECORD`, and `record.viewport` merges over the default viewport. A flat spread would wipe sibling defaults. Recording is off by default and never runs unless explicitly requested.

**`src/index.js`**: `runTests({ testFilters, recordOverrides })` is the main orchestrator:
1. Loads config via `loadConfig()`, then overlays `recordOverrides` onto a **copy** of `config.record` (never mutate it, it can be the shared `DEFAULT_RECORD` object)
2. Probes for ffmpeg via `assertFfmpegAvailable()` when recording, before anything expensive, so a missing binary fails fast instead of after launch and navigation
3. Launches Puppeteer with configured headless mode and args
4. `page.setViewport(record.viewport)` when recording (a normal run keeps Puppeteer's implicit 800x600)
5. Navigates to the configured URL (default: `http://localhost:5173`)
6. Waits for `#twd-sidebar-root` selector (indicates app + TWD are ready)
7. Injects the framing stylesheet when recording, hiding the sidebar and resetting the html margin twd-js sets inline
8. Enumerates all registered test handlers and computes pre-order execution order
9. Resolves `--test` filters into the id list to run
10. Starts the screencast when recording. This happens **after** filter resolution, because `page.screencast()` fixes the output path up front and the filename is derived from the tests that survived the filter (`src/recordFilename.js`)
11. Runs tests in ordered chunks via `runByIds(chunkIds)`, with chunk size controlled by config; accumulates results in Node so the run can stop after `maxFailures` failures and partial results survive a timeout or crash
12. Stops the recorder, then reports the artifact, but only after checking the file has bytes on disk. A resolved `stop()` is not evidence of a usable video (see the recording notes below)
13. Prints a relay-style summary block (`formatRunComplete` in `src/testSummary.js`) as the last output: passed/failed/skipped counts, duration, failed tests with `suite > test` paths and error messages, retried tests, and "Not run" count if stopped early. Known infrastructure errors (dev server down, sidebar missing, protocol timeout, Chrome launch failure) get actionable diagnostics from `src/diagnostics.js`.
14. Optionally collects `window.__coverage__` and writes to `.nyc_output/out.json` (skipped whenever the run has failures, including an early bail)
15. Returns boolean `hasFailures`

**`src/recorder.js`** holds the screencast wrapper: `assertFfmpegAvailable()` (pre-flight `spawnSync(ffmpegPath, ['-version'])` probe), `FRAMING_CSS` / `applyRecordingFraming()`, and `startRecording()` which creates the output dir and calls `page.screencast()`.

### Recording gotchas

These are load-bearing and easy to undo by accident:

- **`stopRecorder()` must run before `browser.close()` on both the success and `catch` paths, and at most once.** If the browser closes first, ffmpeg is orphaned and the file is truncated. The closure nulls `recorder` before awaiting, so a throw between the success-path stop and `browser.close()` cannot double-stop.
- **`record.ffmpegPath` has to reach `page.screencast()`, not just the probe.** Puppeteer spawns its own ffmpeg and defaults to a bare `ffmpeg` on PATH, so forwarding only to the probe produces a passing pre-flight followed by a raw `spawnSync ffmpeg ENOENT`.
- **A 0-byte output is a normal outcome, not a crash.** Puppeteer's frame pipeline buffers with `bufferCount(2, 1)` and Chrome only emits screencast frames on a compositor update, so a suite that never repaints (or an empty run) finishes cleanly with an empty file. `recordedFileSize()` gates the success line on real bytes.
- **`viewport.deviceScaleFactor` does not affect the video.** Puppeteer measures the recording with `deviceScaleFactor` forced to 0, so the emulated factor never reaches the encoder, but it *is* live on the page during the run. Default is `1`. Puppeteer's actual output-size knob is `scale`, which this feature does not expose.

**`test-example-app/`** — A React demo app with TWD tests integrated, used for manual testing/demonstration. Not part of the published package or test suite.

## Testing

Tests are in `tests/` and use vitest, one file per `src/` module. The suite mocks `fs` to test config loading and mocks Puppeteer to test the run flow. Coverage is configured for `src/**/*.js` only.

No test may require a real ffmpeg binary or a real browser: `node:child_process` and `page.screencast` are always mocked. Note that `vi.mock('fs')` auto-mocks `fs.statSync` to return `undefined`, so anything reading a `Stats` has to tolerate that.

## Key Dependencies

- **puppeteer** — Browser automation (launches Chrome/Chromium)
- **twd-js** — not a dependency of this package; the user's app bundles it, which provides the in-browser `__testRunner` and `#twd-sidebar-root` this CLI drives
