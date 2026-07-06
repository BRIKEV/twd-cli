# AI-Friendly Output & Error Diagnostics for twd-cli

**Date:** 2026-07-06
**Status:** Approved for implementation

## Motivation

twd-cli's output is consumed primarily by CI logs and AI agents running TDD loops
(run tests → read failures → fix → re-run). An analysis against twd-relay's `run`
subcommand (`twd-relay/src/cli/run.ts`) confirmed that twd-relay's output design is
significantly better for this audience:

1. **Failure detail placement.** twd-relay's final block shows the full
   `suite > test` path plus the error message together. twd-cli's final
   `Failed tests:` block shows only the bare test name — the error message is
   buried in the per-test tree, forcing the reader to correlate them.
2. **Signal-to-noise.** twd-relay is silent during the run and prints one summary
   block ("every line printed costs context tokens"). twd-cli prints a full config
   JSON dump, status chatter, and the entire test tree including passing tests —
   100+ lines of noise per TDD iteration on a moderate suite.
3. **Actionable infrastructure errors.** twd-relay explains cause + remediation for
   its failure modes. twd-cli dumps raw Puppeteer errors for the two most common
   failures an AI hits: dev server down and TWD sidebar never mounting. (The one
   exception — the existing `protocolTimeout` special case — is exactly the right
   pattern and becomes the template.)
4. **Silent exits.** `bin/twd-cli.js`'s catch exits 1 with no output.

## Decisions

- **AI-first output is the default.** No `--reporter` flag; one code path. A
  `--verbose` flag can be added later if the tree output is missed.
- **Mirror twd-relay's format exactly** (same block shape, `×` marker, no ANSI
  colors in the block) so agents parse one format across the ecosystem.
- **In-place rewrite of twd-cli's reporting layer** (Approach A). No changes to
  twd-js or twd-relay; no shared package (revisit if the format grows); no
  relay-event rearchitecture (conflicts with the future twd-runner direction).

## Output Format

### Passing run (entire output)

```
Navigating to http://localhost:5173 ...
Running 12 test(s)...
Code coverage data written to .nyc_output/out.json

--- Run complete ---
  Passed: 12 | Failed: 0 | Skipped: 0
  Duration: 4.2s
```

### Failing run (adds failure block)

```
--- Run complete ---
  Passed: 10 | Failed: 2 | Skipped: 0
  Duration: 4.2s

  Failed tests (2):
    × Login > shows error on wrong password
      Expected element to be visible (at http://localhost:5173/login)
    × Signup > validates email
      Timeout waiting for selector ".error" (at http://localhost:5173/signup)
```

### Rules

- **Removed:** config JSON dump, `Starting TWD test runner...`,
  `Page loaded. Starting tests...`, `Tests to report: N`, `Browser closed.`, and
  the per-test tree (`reportResults` from `twd-js/runner-ci` is no longer called).
- **Kept:** `Navigating to <url> ...` (context for which URL was targeted), the
  `--test` filter messages (`Filtering: running N test(s)...` and the no-match
  error), coverage lines, and the contract report (out of scope; already has its
  own format).
- Failure paths are built with the existing `buildTestPath()`
  (`suite > subsuite > test`). Error messages keep the current
  `(at <window.location.href>)` suffix so agents know the route.
- Retried tests appear inside the block in the same style:
  `Retried (1): ✓ Login > shows error (passed on attempt 2)`.
- Multi-line error messages are indented to align under their test line
  (same `replace(/\n/g, ...)` treatment as twd-relay).
- No ANSI color codes in the summary block.
- The `--- Run complete ---` block is always the **last** output of a completed
  run — coverage and contract lines print before it, so the tail of the output is
  always the summary + failures (the part an agent reads first).
- Exit codes unchanged: 0 = all pass, 1 = any failure (test, contract, or
  infrastructure).

## Error Diagnostics

New module `src/diagnostics.js` exporting `explainError(error, config)` → a
diagnostic string for known failure modes, or `null` for unknown ones. The
`runTests()` catch block prints the error message first, then the diagnostic.
Messages interpolate the *actual* config values (url, timeout), not defaults.

| # | Failure mode | Detection | Message (cause + remediation) |
|---|---|---|---|
| 1 | Dev server unreachable | `net::ERR_CONNECTION_REFUSED`, `ERR_NAME_NOT_RESOLVED`, `ERR_ADDRESS_UNREACHABLE` from `page.goto` | `Could not reach <url> — connection refused.` / `Is your dev server running? Start it (e.g. \`npm run dev\`) or fix "url" in twd.config.json.` |
| 2 | TWD sidebar never mounts | `TimeoutError` from `waitForSelector('#twd-sidebar-root')` | `Page loaded but the TWD sidebar (#twd-sidebar-root) did not appear within <timeout>ms.` / `Ensure twd-js is initialized in your app and your tests are registered.` / `If the app is slow to start, raise "timeout" in twd.config.json.` |
| 3 | Protocol timeout | existing `isProtocolTimeout()` check (moves into this module) | existing message, unchanged |
| 4 | Browser launch failure | `puppeteer.launch` errors matching `Could not find Chrome` or `Failed to launch the browser process` | `Puppeteer could not launch Chrome.` / `Run \`npx puppeteer browsers install chrome\`, or adjust "puppeteerArgs" in twd.config.json.` |

- **Unknown errors:** print `Error running tests: <message>` then the stack —
  message first, stack after (replaces today's raw object dump).
- **Silent-exit fix:** `bin/twd-cli.js` prints `error.message` in its catch before
  `process.exit(1)` (covers `parseRunArgs` throws, which today exit silently).

## Code Structure

| File | Change |
|---|---|
| `src/testSummary.js` | Rewritten: `formatTestSummary` + `formatFailedTestsBlock` replaced by one `formatRunComplete({ testStatus, handlers, durationMs, retriedTests })` returning the full block as a string. Imports `buildTestPath`. `formatDuration.js` stays. |
| `src/diagnostics.js` | New: `explainError(error, config)`; absorbs `isProtocolTimeout()` from `index.js`. |
| `src/index.js` | Slimmed: drops config dump/chatter and the `reportResults` call, computes test count for the `Running N test(s)...` line from handlers it already queries, calls `formatRunComplete`, uses `explainError` in the catch. |
| `bin/twd-cli.js` | Prints `error.message` before `process.exit(1)`. |

**Dependency consequence:** dropping `reportResults` removes twd-cli's only import
from `twd-js`. If nothing else imports it, remove `twd-js` from `package.json` —
which requires `npm run lock:linux` afterwards (Docker). Verify during
implementation.

## Testing

TDD with the existing vitest + mocked-Puppeteer setup in `tests/`:

- **`formatRunComplete` unit tests:** all-pass block, failures block (asserting
  `suite > test` path + indented error), retries, skips, multi-line error
  indentation, and no ANSI codes in output.
- **`explainError` unit tests:** one per known failure mode asserting the message
  references config values; unknown error returns `null`.
- **Run-flow tests updated:** existing output assertions revised; assert the config
  dump is gone and the summary block prints; exit-code behavior unchanged.
- **Manual verification** against `test-example-app/`: a green run, a
  deliberately-broken test (failure block), and a stopped dev server
  (diagnostic #1).

## Out of Scope

- Contract report format (unchanged).
- JSON/machine-readable reporter.
- `--verbose` flag restoring the tree (add later if requested).
- Any changes to twd-js or twd-relay.
