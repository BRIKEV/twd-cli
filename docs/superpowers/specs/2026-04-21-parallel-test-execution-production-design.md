# twd-cli Parallel Test Execution (Production) — Design Spec

**Date:** 2026-04-21
**Status:** Proposed
**Depends on:** `poc/parallel/` findings (proved SW isolation, coverage split, 1.83× speedup at N=2)

## Purpose

Ship an opt-in `parallel: true` mode in `twd-cli` that runs a project's TWD test suite across two isolated Puppeteer browser contexts concurrently, cutting wallclock test time to roughly half. Zero regression risk for existing users — the serial code path is preserved byte-for-byte and `parallel: false` remains the default.

The POC at `poc/parallel/` validated the three risky assumptions: `browser.createBrowserContext()` isolates service-worker registrations, per-worker `window.__coverage__` dumps merge cleanly via `nyc report`, and the full suite passes at N=2 with a ~1.83× speedup on a developer laptop. This spec turns that throwaway script into a supported feature with proper retries, contract-mock handling, and unit-test coverage.

## Scope

**In scope:**
- New boolean `parallel` field in `twd.config.json` (default `false`).
- New module `src/runParallel.js` implementing the parallel execution path.
- New utility `src/mergeMocks.js` for combining contract mocks collected across workers.
- `src/index.js` branches on `config.parallel` and delegates when true. Serial path untouched.
- Anti-throttle Chromium flags automatically added to the launch arguments.
- Existing `config.retryCount` honored per worker via `TestRunner`'s built-in retry loop.
- Existing contract validation pipeline runs unchanged after a post-workers mock merge step.
- Per-worker coverage dumps to `<nycOutputDir>/out-<i>.json`, always (even on failures).
- Unit tests in `tests/runParallel.test.js` and `tests/mergeMocks.test.js`.

**Out of scope (explicitly deferred):**
- User-configurable worker count. `N` is hardcoded to `2` in this release.
- Unified reporting tree across workers — results print as two separate trees plus a summary. A follow-up spec can build a canonical-path-merged tree.
- Cross-machine / cross-CI-job sharding.
- Changes to twd-js test ID generation (random → deterministic). Separate spec.
- Per-test or per-worker timeout overrides.
- Dynamic `N` based on `os.cpus()` detection.
- Starting the dev server from inside the runner.

## Dependencies

No new runtime dependencies. Reuses the already-bundled `puppeteer` (^24.42.0) and `twd-js` (^1.7.2).

## Config

New optional boolean field in `twd.config.json`:

```jsonc
{
  "url": "http://localhost:5173",
  "parallel": true,          // NEW — defaults to false; opt-in
  "retryCount": 2,           // existing; applied inside each worker
  "contracts": [ ... ],      // existing; mocks merged across workers before validation
  "coverage": true,          // existing; produces per-worker out-<i>.json files
  "timeout": 10000,          // existing; applied per worker for waitForSelector
  "puppeteerArgs": [...],    // existing; anti-throttle flags appended if not present
  "nycOutputDir": "./.nyc_output",
  "coverageDir": "./coverage",
  "headless": true,
  "contractReportPath": "..."
}
```

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `parallel` | No | `false` | When `true`, tests run in two isolated browser contexts concurrently. |

All other fields keep their existing semantics. In particular, `retryCount: 2` (the existing default) continues to apply — each worker's in-browser `TestRunner` retries its own failing tests up to `retryCount` times before declaring them failed, exactly as it does in serial mode.

## Architecture

### File layout

```
src/
├── index.js            # runTests() — thin branch on config.parallel
├── config.js           # unchanged except DEFAULT_CONFIG.parallel = false
├── runParallel.js      # NEW — parallel orchestration (~200 LoC)
├── mergeMocks.js       # NEW — merges per-worker mock maps (~30 LoC)
├── contracts.js        # unchanged
├── contractReport.js   # unchanged
├── contractMarkdown.js # unchanged
├── buildTestPath.js    # unchanged
└── formatMockLabel.js  # unchanged

tests/
├── runTests.test.js    # existing serial tests — unchanged
├── runParallel.test.js # NEW — mirrors runTests.test.js; mocks puppeteer
└── mergeMocks.test.js  # NEW — pure-function unit tests
```

Keeping the serial path in `index.js` unchanged makes the diff for this feature minimal, the rollback trivial, and the risk to existing users zero.

### `runTests()` branch

```js
// src/index.js (sketch)
import { runParallel } from './runParallel.js';

export async function runTests() {
  const config = loadConfig();
  const workingDir = process.cwd();

  let contractValidators = [];
  if (config.contracts?.length) {
    contractValidators = await loadContracts(config.contracts, workingDir);
  }

  if (config.parallel) {
    return runParallel(config, workingDir, contractValidators);
  }

  // existing serial flow — unchanged
  ...
}
```

### `runParallel(config, workingDir, contractValidators)` flow

```
1. Clean config.nycOutputDir so stale serial out.json doesn't bleed into the merge.
2. puppeteer.launch({
     headless: config.headless,
     args: mergeArgs(config.puppeteerArgs, ANTI_THROTTLE_FLAGS),
   })
3. In Promise.all for i in 0..1 (WORKERS = 2):
   a. browser.createBrowserContext() → ctx[i]
   b. ctx[i].newPage() → page[i]
   c. If contracts configured:
        page[i].exposeFunction('__twdCollectMock', mockCollectorFor(i))
      where mockCollectorFor(i) writes into workerMocks[i] with a
      composite dedup key.
   d. page[i].goto(config.url)
      page[i].waitForSelector('#twd-sidebar-root', { timeout: config.timeout })
   e. page[i].evaluate(runByIdxModN, { workerIndex: i, N: 2, retryCount: config.retryCount })
      → { status, handlers }
         (self-filters inside the page: idx % N === workerIndex)
   f. coverage = page[i].evaluate(() => window.__coverage__)
      if (coverage) fs.writeFileSync(nycOutputDir/out-i.json, JSON.stringify(coverage))
   g. ctx[i].close()
4. Merge results:
   - mergedMocks = mergeMocks(workerMocks)
   - Per-worker: reportResults(handlers[i], status[i]) with a "Worker i" header
   - Sum pass/fail/skip counts across workers
5. If contractValidators.length:
   - Enrich each mock with testName via buildTestPath using the mock's
     workerIndex to pick the correct handler tree.
   - hasContractErrors = printContractReport(validateMocks(mergedMocks, ...))
   - Optionally write markdown report (contractReportPath) — same as serial.
6. browser.close()
7. Return hasFailures (any test failed OR any contract error).
```

### Why self-filter by index (not probe + distribute)

twd-js generates test IDs with `Math.random()` at module load (`twd/src/runner.ts:52`). IDs are not stable across browser contexts. The POC originally tried to probe one context, split IDs in Node, and pass chunks to each worker — and discovered that chunks from the probe context meant nothing in other contexts (`runByIds` silently matched zero tests).

Self-filtering inside each worker's `page.evaluate` avoids this entirely: each worker enumerates its own `__TWD_STATE__.handlers` and selects `idx % N === workerIndex`. Registration **order** is stable (same source code, same `describe`/`it` sequence), so the partition is deterministic and disjoint.

### Anti-throttle launch flags

```js
const ANTI_THROTTLE_FLAGS = [
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
];
```

These prevent Chromium from de-prioritizing renderers it considers "hidden" — relevant for headless multi-context runs. In POC testing they materially reduced `waitFor` timeouts at N=2-3. The flags are appended to the user-supplied `puppeteerArgs` only if not already present (user's explicit flag wins).

## Contract Mock Merging

Each worker has its own page, therefore its own `exposeFunction` registration, therefore its own Node-side collector closure and Map. After both workers finish running their chunks, `mergeMocks` combines them:

```js
// src/mergeMocks.js (sketch)
export function mergeMocks(workerMaps) {
  const merged = new Map();
  workerMaps.forEach((workerMap, workerIndex) => {
    for (const [key, mock] of workerMap) {
      // Worker-index prefix guarantees no silent collision if two workers
      // happen to generate the same random testId.
      merged.set(`w${workerIndex}:${key}`, mock);
    }
  });
  return merged;
}
```

Because round-robin distribution puts each test in exactly one worker, the same test's mocks never appear in both workers' maps. The prefix is defense-in-depth against accidental ID collision from the `Math.random()` ID generator.

Each mock carries its `workerIndex`, so downstream enrichment (`buildTestPath`) uses the correct worker's handler tree when resolving `testId → testName`.

`validateMocks(merged, contractValidators)` and `printContractReport(...)` run unchanged — they don't care how the Map was built.

## Reporting

Per-worker trees plus a summary — simplest correct thing for v1:

```
Starting TWD test runner (parallel mode, 2 workers)...
Configuration: { parallel: true, ... }

Worker 0: 30/60 tests selected
Worker 1: 30/60 tests selected

────── Worker 0 results ──────
App Component
  ✓ should render the main heading
  ✓ should handle button clicks
  ...
Worker 0: 30 passed, 0 failed, 0 skipped

────── Worker 1 results ──────
Contract Validation - Users API
  ✓ should mock GET /api/users
  ...
Worker 1: 30 passed, 0 failed, 0 skipped

────── Summary ──────
Total: 60 passed, 0 failed, 0 skipped
Parallel test time: 34.8s
```

Decisions:
- Reuse `reportResults(handlers, testStatus)` from `twd-js/runner-ci` per worker with that worker's own handler tree and results. No twd-js changes required.
- Contract report (if configured) prints after the summary, using the merged mock set.
- A unified single tree across workers is a deliberate follow-up. It requires canonicalizing tests by suite-path (because IDs differ per context) and is better solved in a twd-js spec that adds deterministic IDs.

## Error Handling

- **Worker rejects (Puppeteer / navigation error)**: `Promise.all` rejects → close browser → exit code 1. No partial recovery.
- **Test failures inside a worker**: captured in that worker's `testStatus`, summed into total fail count → exit code 1. The other worker's results still render.
- **Dev server unreachable**: both workers fail `page.goto` — error logged, exit code 1.
- **`waitForSelector` timeout**: reuse `config.timeout` per worker. A timeout in one worker fails the run.
- **Coverage write fails**: log a warning, do not fail the run. Matches existing serial behavior.
- **Contract validator load fails**: already handled in the shared `loadContracts` path — parallel mode inherits that behavior.

## Testing

### `tests/runParallel.test.js`

Mirrors the shape of the existing `tests/runTests.test.js`. Mocks `puppeteer` and `twd-js/runner-ci`. Asserts:

- When `config.parallel === false`, `runTests` delegates to the existing serial flow (indirectly — `runParallel` is not called). Existing tests for serial behavior in `runTests.test.js` continue to pass unchanged.
- When `config.parallel === true`:
  - `puppeteer.launch` called once with anti-throttle flags in `args`.
  - `browser.createBrowserContext` called twice.
  - Each context creates a page, calls `goto` with `config.url`, and `waitForSelector('#twd-sidebar-root', { timeout: config.timeout })`.
  - `page.evaluate` called with a payload containing `workerIndex` and `N: 2`.
  - `config.retryCount` is propagated into the evaluate payload.
  - Returned statuses are summed into total pass/fail counts.
  - Per-worker coverage files `out-0.json` and `out-1.json` are written when the mocked `__coverage__` is non-null.
  - Exit value is `true` (has failures) when any worker reports a `fail`.
- Contract collection path: when `config.contracts` is non-empty, each page calls `exposeFunction('__twdCollectMock', ...)`. A synthetic mock pushed through the mock collector appears in the final merged set passed to `validateMocks`.

### `tests/mergeMocks.test.js`

Pure-function tests — no puppeteer mocking needed:
- Empty input → empty map.
- Single worker → all entries preserved, keys prefixed.
- Two workers with disjoint keys → union.
- Two workers that happen to use the same inner key (simulated collision) → no overwrite; both preserved under different prefixed keys.
- `workerIndex` attached to each output mock matches the source worker.

### Manual acceptance

Against a known-instrumented target app (or `test-example-app` once it receives `vite-plugin-istanbul`):

- `parallel: false` produces byte-identical output to pre-feature twd-cli.
- `parallel: true` produces the same pass/fail counts as serial for a clean suite.
- `npx nyc report` on the resulting `.nyc_output/` merges `out-0.json` + `out-1.json` into a coherent report comparable to the serial baseline.
- With contracts configured, the contract report shows the same mock-by-mock breakdown as serial.

## Success Criteria

- **Correctness**: `parallel: true` produces the same pass/fail/skip counts as `parallel: false` for any suite that passes serially.
- **Coverage parity**: merged coverage at N=2 matches serial baseline within ±1 percentage point on all four nyc metrics (statements/branches/functions/lines).
- **Speedup**: at N=2 on a 4-core dev machine, wallclock is at most 60 % of serial wallclock for suites over 15 seconds.
- **Zero regression**: with `parallel` absent or `false`, output is byte-for-byte identical to the prior release's output for the same config.
- **Contract behavior parity**: with contracts configured, the printed report and markdown artifact match serial exactly.

## Rollout Notes

- Feature is opt-in — no user has to do anything to keep existing behavior.
- Document in `README.md`: new config field, expected speedup range, CI caveat (default `retryCount: 2` recommended; bump `timeout` if running on constrained CI runners).
- Document the known issue that `workers > 2` is not currently exposed and that unified reporting is per-worker until a follow-up release.

## Follow-ups (tracked separately, not this spec)

1. **Deterministic test IDs in twd-js** — replace `Math.random()` with a hash of the `describe > it` path. Unblocks unified reporting, cross-machine sharding, and reliable retry-by-id.
2. **Unified reporting tree** — once IDs are deterministic, merge per-worker results into one canonical tree.
3. **Configurable `workers: N`** with auto-detection (`os.cpus().length / 2`), plus per-worker retry and timeout budgets.
4. **Cross-CI-job sharding** — `twd-cli run --shard i/N` for splitting across multiple runners.
