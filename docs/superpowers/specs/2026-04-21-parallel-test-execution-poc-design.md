# twd-cli Parallel Test Execution POC — Design Spec

**Date:** 2026-04-21
**Status:** Proposed
**Type:** Proof of concept (throwaway / experimental)

## Purpose

Prove the viability of running twd-cli's browser-based test suite in parallel across multiple isolated browser contexts, without adding any new third-party library (no `puppeteer-cluster` or similar).

The core risky assumption is: **Puppeteer's `browser.createBrowserContext()` truly isolates service worker registrations** between contexts, which is required because TWD tests register mocks through a service worker (MSW-style). If two parallel workers each mocked the same URL with different responses, cross-context SW leakage would corrupt results.

The POC answers three yes/no questions:

- **(a)** Do incognito-style browser contexts isolate the service worker / mock registrations?
- **(b)** Can we split `window.__coverage__` into per-worker files that merge cleanly with `nyc`?
- **(c)** Does the full `test-example-app` test suite pass with identical pass/fail counts when split across N workers?

Wallclock speedup is explicitly out of scope for viability. If the POC passes, a production feature will be designed in a follow-up spec.

## Scope

**In scope:**
- Standalone Node script under `twd-cli/poc/parallel/` that drives parallel execution against `test-example-app/`.
- Single `puppeteer.launch()` with N isolated `browser.createBrowserContext()` workers.
- Round-robin distribution of test IDs across workers, invoked through the existing `window.__testRunner.runByIds()` API.
- Per-worker coverage dump to `.nyc_output/out-<i>.json`.
- Findings documented in a `README.md` alongside the POC script.

**Out of scope:**
- Any change to `src/index.js`, `src/config.js`, or the published `runTests()` API.
- CLI flags or `twd.config.json` options for parallelization.
- Contract validation and `__twdCollectMock` plumbing in parallel mode.
- Retry logic in parallel mode (`retryCount` is not honored by the POC).
- Pretty tree reporting; the POC prints pass/fail counts per worker and overall.
- Wallclock benchmarking (user may run it informally, but not a gate).
- Cross-machine CI sharding.
- Automatic nyc merging — the user runs `npx nyc report` themselves.

## Approach

**Single Puppeteer browser, N isolated browser contexts** (equivalent to N parallel incognito windows).

Rejected alternatives:
- *N separate `puppeteer.launch()` instances* — heavier, slower startup, overkill for the POC. Kept in mind as a fallback if context isolation fails (see Failure Modes).
- *`child_process.fork` copies of the existing CLI* — maximum code reuse but much more orchestration, and spawns N Chrome processes anyway. More appropriate for the eventual production feature.

## File Layout

```
twd-cli/
├── poc/
│   └── parallel/
│       ├── README.md          # how to run, findings log
│       └── run-parallel.js    # the POC script (ESM, ~150 LoC)
└── test-example-app/          # the target app, unchanged
```

- `run-parallel.js` is runnable from `test-example-app/` as `node ../poc/parallel/run-parallel.js [N]`.
- No package.json changes, no new dependencies. Imports `puppeteer` from the already-present `twd-cli/node_modules`.
- Checked in so findings are preserved; not exported from the package and not referenced by `bin/twd-cli.js`.

## Execution Flow

User command:

```bash
# from test-example-app/ (with `npm run dev` already running on port 5173)
node ../poc/parallel/run-parallel.js 2
```

Argument: number of workers (default `2`).

```
1. Parse N from process.argv[2] (default 2).

2. Clear .nyc_output/ (rm -rf, then mkdir -p) so stale serial runs
   don't pollute the merge.

3. puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })

4. Worker 0 (serves double duty as probe + worker):
   a. browser.createBrowserContext() → context0
   b. context0.newPage() → page0
   c. page0.goto(URL, { waitUntil: 'networkidle0' })
   d. page0.waitForSelector('#twd-sidebar-root', { timeout: 10000 })
   e. page0.evaluate → read test IDs:
        Array.from(window.__TWD_STATE__.handlers.values())
          .filter(h => h.type === 'test')
          .map(h => h.id)
   f. Split IDs into N chunks via round-robin (see Test Distribution).

5. Promise.all of N tasks — worker 0 continues on its existing page,
   workers 1..N-1 create their own context + page from scratch:

   • Worker 0: page0.evaluate(chunks[0]) → runByIds → collect coverage
   • Worker i (i > 0):
       - browser.createBrowserContext() → contextI
       - contextI.newPage() → pageI
       - pageI.goto(URL), waitForSelector('#twd-sidebar-root')
       - pageI.evaluate(chunks[i]) → runByIds → collect coverage

6. Each worker, on completion:
   - fs.writeFileSync(`.nyc_output/out-${i}.json`, JSON.stringify(coverage))
     regardless of pass/fail (see Coverage Output).
   - contextI.close()

7. Aggregate pass/fail counts. Print:
      Worker 0: 27 passed, 0 failed
      Worker 1: 28 passed, 0 failed
      Total:    55 passed, 0 failed (expected 55)

8. browser.close(). Exit code = anyWorkerFailed ? 1 : 0.
```

## Test Distribution

Round-robin by index:

```js
const chunks = Array.from({ length: N }, () => []);
testIds.forEach((id, i) => chunks[i % N].push(id));
```

Chosen over contiguous chunking because `test-example-app/src/App.twd.test.ts` clusters related tests inside `describe()` blocks (e.g., all Products contract-mismatch tests are contiguous). Contiguous chunks would pile entire suites onto one worker and leave another doing only render tests; round-robin spreads any systematic slowness or state across workers evenly.

### Why splitting suites across workers is safe

`window.__testRunner.runByIds(ids)` (defined in `twd/src/runner.ts:284`) already handles partial execution correctly:

- `collectHooks(test.parent!)` in `runner.ts:195-205` walks up the suite tree from each test's direct parent and collects all `beforeEach` / `afterEach` hooks along the way, **per test**.
- Siblings of the test are irrelevant to its hook chain. If "test A" and "test B" live in the same `describe()` but go to different workers, both still get the same `beforeEach` invocations, because each worker re-walks the tree independently.
- TWD has no `beforeAll` / `afterAll` hooks (only `beforeEach` / `afterEach`), so there are no "run-once-per-suite" semantics that splitting could break.
- Every worker loads the full app bundle, so each worker's `__TWD_STATE__` contains the complete suite tree and all hook registrations. We only tell `runByIds` *which tests to run*, not which suites to build.

The `stack` array in `__TWD_STATE__` is used transiently during test registration (to track current `describe` nesting while the DSL builds the tree). By the time tests run, it is empty — not relevant to parallelization.

## Coverage Output

Each worker writes its own file:

```
test-example-app/
└── .nyc_output/
    ├── out-0.json     ← worker 0
    ├── out-1.json     ← worker 1
    └── out-<i>.json   ← worker i
```

Inside each worker, after `runByIds` completes:

```js
const coverage = await page.evaluate(() => window.__coverage__);
if (coverage) {
  fs.writeFileSync(
    path.join(nycDir, `out-${workerIndex}.json`),
    JSON.stringify(coverage)
  );
}
```

### Differences from the serial CLI

- **Always dump, even on failure.** `src/index.js:136` skips coverage when `hasFailures` is true. The POC inverts this — every worker dumps unconditionally — so a single flaky test doesn't blind us to the other workers' behavior, and we can confirm criterion (c) per worker.
- **Clean `.nyc_output/` at startup.** `fs.rmSync(nycDir, { recursive: true, force: true })` then `fs.mkdirSync(nycDir, { recursive: true })` before step 4 — prevents stale files from a previous serial run from bleeding into the merge.

### Merging (user-side)

nyc automatically picks up all `*.json` files in `.nyc_output/` and unions the hit counts. After the POC runs, the user verifies:

```bash
npx nyc report --reporter=text
# or full HTML:
npx nyc report --reporter=html
```

No merging logic inside the POC itself. If merging turned out to be fiddly (it shouldn't be — this is `nyc`'s designed behavior), that would be recorded as a failure mode.

## Success Criteria & Verification

### Baseline capture

Before running the POC, capture the serial baseline from the existing CLI:

```bash
cd test-example-app
rm -rf .nyc_output
npx twd-cli run | tee /tmp/baseline.log
npx nyc report --reporter=text | tee /tmp/baseline-cov.log
```

Note: total test count, pass count, fail count, total covered %.

### Parallel run

```bash
rm -rf .nyc_output
node ../poc/parallel/run-parallel.js 2 | tee /tmp/parallel.log
npx nyc report --reporter=text | tee /tmp/parallel-cov.log
```

### Pass conditions

**(c) Tests run to completion** — pass/fail breakdown in `parallel.log` matches `baseline.log`. Same total count, same number of passes, same number of failures. If the parallel run is missing tests, something is being skipped or the distribution logic is dropping IDs.

**(a) Service-worker isolation** — because the existing suite has multiple tests mocking overlapping URLs (e.g., `/api/products` across Products-valid and Products-mismatches describes), round-robin splitting at N=2 forces those concurrent overlapping mocks across different contexts. If criterion (c) holds, (a) holds implicitly — if contexts shared SW state, overlapping mocks would contaminate each other and contract-validation tests would fail differently from serial.
As a cheap guard against accidentally assigning the same chunk twice, the POC logs each worker's `[index, firstTestId, lastTestId, chunkLength]` before running. Overlapping IDs across workers would indicate a distribution bug, not an isolation bug.

**(b) Coverage split works** — both `.nyc_output/out-0.json` and `.nyc_output/out-1.json` exist and are non-empty, `npx nyc report` runs without error, and the merged totals are close to the serial baseline. They won't be identical — execution order differs slightly — but file count and overall % should be in the same ballpark (within a percentage point or two).

## Failure Modes

If the POC fails, the `README.md` records which mode and we adapt:

- **F1 — tests fail under parallel that pass serially.** SW isolation broken across `browser.createBrowserContext()`. Fallback: swap to N separate `puppeteer.launch()` instances (same script shape, different launch call). Document the evidence so we know why we took the heavier path.
- **F2 — coverage files exist but `nyc report` errors or produces garbage.** Investigate how `window.__coverage__` is keyed and whether parallel contexts clobber each other. May need per-worker coverage dir rather than per-worker file.
- **F3 — workers hang or time out.** Renderer-pool contention, or something in Puppeteer's context model we don't understand. Try lower N, try `headless: false` for visual inspection.
- **F4 — works but no wallclock speedup.** Explicitly NOT a POC failure per criterion scope, but worth noting in findings so the production feature design knows to investigate (renderer pool sizing, CPU pinning, etc.).

## Findings Artifact

`poc/parallel/README.md` becomes the write-up. At minimum it includes:

- The command(s) used.
- Values of N tested.
- Baseline vs parallel pass/fail counts.
- Baseline vs parallel coverage percentages.
- Observed wallclock times (informational).
- Which criteria (a) / (b) / (c) passed.
- Any anomalies, flaky tests, or unexpected behavior.

This becomes the input to the production feature spec if the POC passes.
