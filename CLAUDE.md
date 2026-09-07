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

**`src/changedTests.js`**: `resolveChangedTitles(ref, cwd)` shells out to git (`execFileSync` with an argument array, never a string — a ref is user input) and returns the `it()` titles this branch added or changed, to feed the same filter path `--test` uses. `extractTitles(source)` is the pure half. Test files are identified by the **suffix** `*.twd.test.*`, never by directory: the examples use `src/twd-tests`, `app/twd-tests` and `src/twd-test` between them, and the suffix also keeps a project's Vitest suite — which uses `it()` too — from contributing titles. Diffs to the **working tree** (`git diff <base>`, no second ref) and adds untracked test files, so uncommitted work counts; in CI the tree is clean and this is identical to `<base> HEAD`.

**`src/parseArgs.js`**: `parseRunArgs(argv)` returns `{ testFilters, record }`. Supports `--test` (repeatable substring filter) and the recording flags `--record`, `--record-dir`, `--record-speed`. Each accepts both `--flag value` and `--flag=value`. The returned `record` object is passed to `runTests()` as `recordOverrides` and wins over the config file.

**`src/config.js`**: `loadConfig()` reads `twd.config.json` from `process.cwd()`, merges it with defaults (url, timeout, coverage, coverageDir, nycOutputDir, headless, puppeteerArgs, retryCount, protocolTimeout, maxFailures, chunkSize, record), and returns the merged config. Falls back to defaults if the file is missing or unparseable.

`--changed-since` deliberately makes a zero-match run exit **0**: it is a query, and an empty result is a normal CI outcome. `--test` keeps its exit 1, because a filter you typed is an assertion and a typo must not look like a pass. For the same reason the "matched no tests" warning is raised only for filters the user actually typed — a computed title matching nothing is unactionable noise.

`protocolTimeout` (default `300000`, 5 min) is passed to `puppeteer.launch` and bounds each chunk's CDP call. `maxFailures` (default `10`) stops the run after that many cumulative test failures; set to `0` to disable. `chunkSize` (default `10`) controls how many tests run per browser call.

`record` (`DEFAULT_RECORD`) is the only **nested** config key, so the merge goes two levels deep: `record` merges over `DEFAULT_RECORD`, and `record.viewport` merges over the default viewport. A flat spread would wipe sibling defaults. Recording is off by default and never runs unless explicitly requested.

**`src/index.js`**: `runTests({ testFilters, recordOverrides })` is the main orchestrator:
1. Loads config via `loadConfig()`, then overlays `recordOverrides` onto a **copy** of `config.record` (never mutate it, it can be the shared `DEFAULT_RECORD` object)
2. Probes ffmpeg via `assertFfmpegCapable()` when recording, before anything expensive, so an unusable binary fails fast instead of after launch and navigation. It checks the **capability**, not the version: `ffmpeg -h muxer=mp4` must list every movflag puppeteer will pass
3. Launches Puppeteer with configured headless mode and args
4. `page.setViewport(record.viewport)` when recording (a normal run keeps Puppeteer's implicit 800x600)
5. Navigates to the configured URL (default: `http://localhost:5173`)
6. Waits for `#twd-sidebar-root` selector (indicates app + TWD are ready)
7. Injects the framing stylesheet when recording, hiding the sidebar and resetting the html margin twd-js sets inline
8. Enumerates all registered test handlers and computes pre-order execution order
9. Resolves `--test` filters and any `--changed-since` titles into the id list to run, as one OR'd set. `--changed-since` itself is resolved back at step 1, **before** the ffmpeg probe and the browser launch, so a branch that changed no tests exits 0 needing neither a dev server nor ffmpeg
10. Starts the screencast when recording. This happens **after** filter resolution, because `page.screencast()` fixes the output path up front and the filename is derived from the tests that survived the filter (`src/recordFilename.js`)
11. Runs tests in ordered chunks via `runByIds(chunkIds)`, with chunk size controlled by config; accumulates results in Node so the run can stop after `maxFailures` failures and partial results survive a timeout or crash
12. Stops the recorder through `stopRecording()`, which never awaits a stop whose encoder is already known dead, then reports the artifact — but only after checking the file has bytes on disk. A resolved `stop()` is not evidence of a usable video (see the recording notes below). An mp4 is converted to H.264 before its size is read
13. Prints a relay-style summary block (`formatRunComplete` in `src/testSummary.js`) as the last output: passed/failed/skipped counts, duration, failed tests with `suite > test` paths and error messages, retried tests, and "Not run" count if stopped early. Known infrastructure errors (dev server down, sidebar missing, protocol timeout, Chrome launch failure) get actionable diagnostics from `src/diagnostics.js`.
14. Optionally collects `window.__coverage__` and writes to `.nyc_output/out.json` (skipped whenever the run has failures, including an early bail)
15. Returns boolean `hasFailures`

**`src/recorder.js`** holds the screencast wrapper: `assertFfmpegCapable()` (pre-flight probe), `createFfmpegLog()` (a puppeteer `logger` that captures ffmpeg's stderr), `FRAMING_CSS` / `applyRecordingFraming()`, `startRecording()` which creates the output dir and calls `page.screencast()`, `watchRecorder()` / `stopRecording()` which keep a dead encoder from hanging the run, and `transcodeForPlayback()` which re-encodes the finished mp4 to H.264.

### Recording gotchas

These are load-bearing and easy to undo by accident:

- **`stopRecorder()` must run before `browser.close()` on both the success and `catch` paths, and at most once.** If the browser closes first, ffmpeg is orphaned and the file is truncated. The closure nulls `recorder` before awaiting, so a throw between the success-path stop and `browser.close()` cannot double-stop.
- **`record.ffmpegPath` has to reach `page.screencast()`, not just the probe.** Puppeteer spawns its own ffmpeg and defaults to a bare `ffmpeg` on PATH, so forwarding only to the probe produces a passing pre-flight followed by a raw `spawnSync ffmpeg ENOENT`.
- **A 0-byte output is a normal outcome, not a crash.** Puppeteer's frame pipeline buffers with `bufferCount(2, 1)` and Chrome only emits screencast frames on a compositor update, so a suite that never repaints (or an empty run) finishes cleanly with an empty file. `recordedFileSize()` gates the success line on real bytes.
- **`viewport.deviceScaleFactor` does not affect the video.** Puppeteer measures the recording with `deviceScaleFactor` forced to 0, so the emulated factor never reaches the encoder, but it *is* live on the page during the run. Default is `1`. Puppeteer's actual output-size knob is `scale`, which this feature does not expose.
- **Never `await recorder.stop()` on an encoder that may already be dead.** Puppeteer's `stop()` ends on `await new Promise(r => this.#process.once('close', r))`. If ffmpeg already exited, that event fired long ago and the listener is never called again, so the await is permanent — it cost a whole CI job once. `watchRecorder()` learns of the death from the stream ending (the recorder is a `PassThrough` fed by ffmpeg's stdout — the child process itself is private), and `stopRecording()` skips the await in that case and bounds it with `STOP_TIMEOUT_MS` otherwise.
- **`watchRecorder()` calls `stop()` the instant the encoder dies, and that call is load-bearing.** Aborting puppeteer's frame pipeline is the only thing that ends the `ffmpeg failed to write` line-per-frame spam. It is deliberately not awaited, for the reason above.
- **ffmpeg's stderr only exists on puppeteer's debug channel.** `puppeteer.launch({ logger })` is the seam; `createFfmpegLog()` filters on `DEBUG_PREFIXES.ffmpeg` and **delegates every other prefix to puppeteer's exported `debug`**, because `launch` does `options.logger ??= debug` and swallowing the rest would silently disable `NODE_DEBUG`. The logger is passed only while recording. `logger` is marked `@experimental` upstream.
- **The required movflags are puppeteer's, not ours.** `REQUIRED_MOVFLAGS` mirrors `ScreenRecorder#getFormatArgs` in puppeteer-core, so re-read that method on a puppeteer bump. This is why the preflight probes `-h muxer=mp4` rather than pinning a version floor — a floor written from one measurement ("7 or newer") was already wrong on the second.
- **The screencast's own output does not play outside Chrome.** Puppeteer feeds ffmpeg PNG frames with no `-pix_fmt`, so RGB rides into VP9 and the file lands as vp9/`gbrp` in an mp4 container. QuickTime and Preview open neither. `transcodeForPlayback()` re-encodes to h264/`yuv420p` in place after the run; measured on a real capture it also cut 202805 bytes to 49222. Failure there is a warning, never fatal — the untranscoded file is still a correct recording.

**`test-example-app/`** — A React demo app with TWD tests integrated, used for manual testing/demonstration. Not part of the published package or test suite.

## Testing

Tests are in `tests/` and use vitest, one file per `src/` module. The suite mocks `fs` to test config loading and mocks Puppeteer to test the run flow. Coverage is configured for `src/**/*.js` only.

No test may require a real ffmpeg binary or a real browser: `node:child_process` and `page.screencast` are always mocked. `tests/runTests.test.js` mocks the two ffmpeg-spawning helpers but deliberately runs the **real** `watchRecorder` / `stopRecording`, because the hang they prevent only appears in the wiring — its recorder stand-ins are real `EventEmitter`s for that reason, since production is handed a `PassThrough`. Note that `vi.mock('fs')` auto-mocks `fs.statSync` to return `undefined`, so anything reading a `Stats` has to tolerate that.

## Releases

The version bump is its own commit on `main`: `package.json`, the lockfile
regenerated with `npm run lock:linux`, and a hand-written `CHANGELOG.md` entry.
The `conventional-changelog` script in `package.json` is **not** used — entries
are written by hand, and tags stopped tracking it after v1.1.15.

`package-lock.json` carries the version in **two** places, the top-level
`version` and `packages[""].version`. Both have to move.

Publishing is driven by a GitHub Release, not by `npm publish` locally.
`publish.yml` triggers on `release: published` and routes prereleases to the
`beta` dist-tag via `github.event.release.prerelease`, so `npm install twd-cli`
keeps resolving to the stable version.

### Release title convention

- **Stable: the title is exactly the tag.** `v1.4.0`, `v1.3.1`, `v1.3.0`. No
  subtitle, no feature name.
- **Prerelease: tag plus a short descriptor and `(beta)`.** For example
  `v1.4.0-beta.1: video recording (beta)`, `v1.3.0-beta.1 — AI-friendly output
  (beta)`.

The release *notes* carry the detail either way; the title does not.

### When the release event does not fire

`publish.yml` has no `workflow_dispatch`, so its only trigger is an event that
cannot be replayed. This has failed at least once (v1.5.0): the Release was
created correctly, non-draft and non-prerelease, but no run appeared and nothing
reached npm. Deleting and recreating the Release object did not re-fire it
either. The fallback is to publish from a clean `main` checkout with
`npm publish --access public`, which needs no CI.

## Key Dependencies

- **puppeteer** — Browser automation (launches Chrome/Chromium)
- **twd-js** — not a dependency of this package; the user's app bundles it, which provides the in-browser `__testRunner` and `#twd-sidebar-root` this CLI drives
