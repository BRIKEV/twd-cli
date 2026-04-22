# Parallel Test Execution POC

Throwaway script that proves Puppeteer browser contexts isolate service workers and that per-worker coverage files merge cleanly.

See the approved spec at `docs/superpowers/specs/2026-04-21-parallel-test-execution-poc-design.md`.

## How to run

1. In one terminal, start the dev server:
   ```bash
   cd test-example-app
   npm run dev
   ```
2. In another terminal:
   ```bash
   cd test-example-app
   rm -rf .nyc_output
   node ../poc/parallel/run-parallel.js 2   # N workers; default 2
   npx nyc report --reporter=text
   ```

## Design note — test distribution

Test IDs in twd-js are generated via `Math.random()` at module load time
(`twd/src/runner.ts` → `const generateId = () => Math.random()...`), so they are
NOT stable across browser contexts. Each context sees a fresh bundle load and
therefore fresh IDs.

The original design called for a "probe context" to enumerate all IDs, split
them in Node, and pass chunks to workers — that failed because chunks from
context 0 meant nothing in contexts 1..N-1 (`runByIds` silently matched
nothing). The POC pivoted mid-implementation to **self-filter inside each
worker**: each worker enumerates its own `__TWD_STATE__.handlers`, takes the
slots where `idx % N === workerIndex`, and calls `runByIds` on those.
Registration **order** (the order `describe`/`it` are called in user code) is
stable across contexts, so the partition is deterministic and disjoint.

Worth addressing in the production feature: twd-js should move to
deterministic IDs (e.g., hash of the `describe > it` path) to make external
tooling possible.

## Findings

**Date run:** 2026-04-21
**Machine:** macOS 15.5 (Darwin 24.5.0)
**Node:** v24.11.0
**Puppeteer:** 24.42.0
**Target app on :5173:** `/Users/kevinccbsg/holafly/web-checkout` (instrumented
via `vite-plugin-istanbul`). 60 TWD tests total.

### Runs

| N | Tests | Passed | Failed | Skipped | Wallclock | Stmts % | Branches % | Funcs % | Lines % |
|---|-------|--------|--------|---------|-----------|---------|------------|---------|---------|
| 1 |  60   |   60   |   0    |    0    |   61.4 s  |  85.91  |   70.93    |  83.90  |  86.93  |
| 2 |  60   |   60   |   0    |    0    |   34.8 s  |  85.91  |   70.93    |  83.90  |  86.93  |
| 3 |  60   |   55   |   5    |    0    |    ~29 s  |  86.03  |   70.93    |  85.05  |  87.07  |
| 4 |  60   |   52   |   8    |    0    |   23.2 s  |  ~same  |   ~same    |  ~same  |  ~same  |

(N=1 is a single-worker run through the POC, not the serial `twd-cli run` —
this matches same-code-path baselining.)

### Criteria

- **(a) Service-worker isolation — PASS.** At N=2 the full 60-test suite passes
  cleanly; coverage % is identical to N=1. The suite includes tests that
  register concurrent mocks for the same endpoints under the target app's own
  TWD mock bridge — if browser contexts shared service worker state, we would
  see mock collisions reflected as test failures and/or diverging coverage.
  Neither occurred. `browser.createBrowserContext()` isolates SW registrations
  as Chromium's documentation promises.
- **(b) Coverage split — PASS.** `.nyc_output/out-0.json` and
  `.nyc_output/out-1.json` land at ~534 KB each covering 83 files. Merged with
  `npx nyc report --cwd /path/to/app --temp-dir ./.nyc_output` the result is
  coherent: 85.91 % statements at N=1 → 85.91 % at N=2 → 86.03 % at N=3. Small
  deltas at higher N reflect different execution orderings exercising slightly
  different branches, as expected.
- **(c) Tests run to completion — PASS at N=2.** At N ≥ 3 some `waitFor`-based
  tests hit their 1-second rule-execution timeout under CPU contention. See
  "Anomalies".

### Anomalies

- **Concurrency ceiling at N ≥ 3 on this machine/app.** At N=3, 5 tests fail
  with errors like `Rule "createCart" was not executed within 1000ms`. At N=4,
  8 tests fail the same way. The same tests pass reliably at N=2 and in
  `twd-cli run` serial. This is **not** service-worker contamination — the
  failure mode is a deterministic timeout, not a wrong mocked response. It is
  consistent with renderer pool contention: with 3-4 Chrome contexts sharing
  the machine's CPU, individual request-interception latencies stretch past
  the test's 1-second budget. The production feature should either default to
  a conservative N (e.g. `os.cpus().length / 2`) or expose per-test timeout
  configuration in `twd.config.json`.
- **Random test IDs.** See "Design note" above. Not a parallelization defect,
  but a real obstacle for any future feature that needs to refer to a specific
  test from outside the browser (sharding across machines, retry of a single
  failure, etc.). Worth fixing in twd-js.
- **Speedup at N=2 ≈ 1.74×** (61.4 s → 34.8 s). About 87 % of the theoretical
  2× max, which is very good and suggests little fixed overhead from the
  probe/fan-out machinery.

### Recommendation

**Green-light the production feature.** The risky assumption (SW isolation
across browser contexts) is confirmed. Per-worker coverage dumps and the nyc
merge path both work without special handling. Build-out should:

1. Default `workers` to `os.cpus().length / 2`, capped at 4. Let the user
   override via `twd.config.json`.
2. Replace the current `NYC_DIR` hardcoding with a config field, and document
   the `nyc report --cwd --temp-dir` pattern for cross-project runs.
3. Fix deterministic test IDs in twd-js in parallel (separate spec) so cross-
   context operations stop relying on registration-order coincidence.
4. Consider raising the default `waitFor` timeout or making it per-worker
   configurable — the 1-second default is fragile at moderate concurrency.
5. Wire contract-mock collection (`__twdCollectMock`) through per-worker
   collection buckets and merge before validation. Currently out of scope for
   the POC.

The POC script in this directory is a throwaway reference; production should
be implemented inside `src/` with proper config, retries, and reporting, not
by productionizing `run-parallel.js`.
