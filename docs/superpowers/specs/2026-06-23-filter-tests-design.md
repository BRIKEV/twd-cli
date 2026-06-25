# Design: `--test` filter for twd-cli

**Date:** 2026-06-23
**Branch:** `feat/filter-tests`
**Status:** Approved

## Goal

Add a `--test` CLI flag to `twd-cli` that runs only a subset of registered TWD
tests, matched by name. This enables quick, targeted execution from the CLI for
easier debugging instead of always running the full suite.

## Behavior

- `--test "<value>"` is **repeatable**. Passing multiple flags means **OR**: a
  test runs if it matches *any* of the values.
- Matching is **case-insensitive substring** against the test's **full path**
  string, `"Suite > Subsuite > test name"`.
  - `--test "shows error"` runs the test whose name contains "shows error".
  - `--test "Login"` runs every test under `describe("Login", …)`, because
    "Login" appears in those tests' full paths. Describe/suite filtering comes
    for free from this one mechanism — there is no separate flag.
- Both `--test <value>` and `--test=<value>` forms are accepted.
- **Zero matches → exit 1** with a clear message listing the filter values that
  matched nothing. A typo in CI/debug must not silently "pass" with 0 tests run.
- When no `--test` flag is given, behavior is unchanged: the full suite runs via
  `runAll()`.

## Why this is feasible

- The browser exposes the test registry at `window.__TWD_STATE__.handlers` — a
  `Map` of `{ id, name, parent, type: 'suite' | 'test', children, depth }`. The
  CLI can read every test/suite name *before* running anything.
- `window.__testRunner` already has `runByIds(ids)`, which runs only the tests
  whose ids are in the set **and** correctly executes their parent suites'
  `beforeEach`/`afterEach` hooks (verified in `twd-js` 1.8.1 bundle).
- The existing `src/buildTestPath.js` already turns a test id + handler list
  into the `"Suite > … > test"` string, so the matcher reuses it.

## Architecture / data flow

1. **`bin/twd-cli.js`** — after the `run` command is matched, parse
   `process.argv` for repeated `--test <value>` / `--test=<value>` into a
   `testFilters` string array. Call `runTests({ testFilters })`. Update the help
   text to document `--test`.

2. **`src/filterTests.js`** (new, pure, unit-testable) —
   `selectTestIds(handlers, filters)`:
   - For each handler with `type === 'test'`, build its full path via
     `buildTestPath(handler.id, handlers)`.
   - Lowercase the path and each filter; the test matches if its path contains
     any filter as a substring.
   - Returns `{ ids: string[], unmatchedFilters: string[] }`, where
     `unmatchedFilters` lists filter values that matched no test (used for the
     zero-match error and diagnostics).

3. **`src/index.js`** — `runTests(options = {})` accepts `options.testFilters`
   (default `[]`):
   - When `testFilters` is non-empty: after `waitForSelector('#twd-sidebar-root')`,
     run one `page.evaluate` that reads `window.__TWD_STATE__.handlers` and
     returns `[{ id, name, parent, type }]`. Call `selectTestIds` **in Node**.
   - If no ids match: log `No tests matched filter(s): "x", "y"`, close the
     browser, and return `true` (→ the CLI exits 1).
   - Otherwise pass the selected ids into the run `page.evaluate`, which calls
     `runner.runByIds(ids)` instead of `runner.runAll()`. Because `runByIds`
     only fires `onPass`/`onFail` for tests that ran, `testStatus` naturally
     contains just the filtered tests and the existing report/summary code needs
     no other change.
   - **Coverage is skipped whenever a filter is active.** A filtered run is a
     debug run; writing partial coverage to `.nyc_output` would pollute later
     full-run reports. This is logged so the skip is not surprising.

## Testing

- **Unit tests for `selectTestIds`** (`tests/filterTests.test.js`): substring
  matching, case-insensitivity, full-path matching that picks up describe names,
  leaf test-name matching, multiple filters (OR), and the no-match case
  populating `unmatchedFilters`.
- **Extend `tests/runTests.test.js`**: a filtered run calls `runByIds` with the
  expected ids; a zero-match filtered run returns `true` (exit 1); coverage is
  skipped when a filter is active.

## Documentation

- Add a "Filtering tests" subsection under Usage in `README.md`: repeatable
  flag, case-insensitive substring matching, matching against the full
  `suite > test` path (so describe names work), worked examples, and the
  zero-match-exits-1 behavior.

## Git / dependencies

- All work on branch `feat/filter-tests`; no commits on `main`.
- No dependency changes, so `npm run lock:linux` is not required.

## Out of scope

- Glob/regex matching, exact-match mode, or a separate `--describe` flag. The
  substring-on-full-path mechanism covers the stated debugging use case; these
  can be added later if a concrete need appears.
- Filtering by file, tag, or status.
