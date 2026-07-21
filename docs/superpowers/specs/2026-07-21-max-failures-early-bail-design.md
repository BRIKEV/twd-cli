# Design: Fail-fast early bail + timeout-durable partial results

**Date:** 2026-07-21
**Status:** Approved (pending spec review)
**Repo:** `twd-cli`

## Problem

On large suites the CLI loses everything on a timeout and wastes minutes on retries.

Concrete case: `holafly/webapp-platform-admin` has 320+ tests. When ~40 fail, each
failing test is retried (`retryCount` default `2`), so the slowest tests run ~80 times.
The whole suite executes inside a **single `page.evaluate`** (`src/index.js:96`), and the
in-browser `testStatus` array is only returned to Node when `runAll()` fully resolves
(`twd/src/runner.ts:266`). When Puppeteer's `protocolTimeout` (default 300000ms) fires
mid-run, that one CDP call rejects, control jumps to the `catch`, and **all accumulated
results are lost** — the CI output is a bare timeout error with no test detail.

Two distinct pains:
- **Wasted time / timeout:** running (and retrying) dozens of failing tests blows the
  protocol timeout.
- **Total result loss:** a timeout (or any crash) mid-run discards every result gathered
  so far.

## Goals

- Stop the run early once too many tests have failed, before the timeout is reached.
- Never lose already-gathered results: print partial results on both an early bail and a
  genuine timeout/crash.
- Keep the change entirely within `twd-cli` — consuming apps upgrade only the CLI, not the
  `twd-js` bundled in their app.

## Non-goals

- No changes to `twd-js` / the `TestRunner` class.
- No "consecutive failures" trigger (explicitly decided against — scattered failures would
  never trip it and could still time out). Trigger is **cumulative total failures**.
- No change to retry semantics, coverage collection mechanics, or the relay-style summary
  format beyond the additions below.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Where the fix lives | `twd-cli` only (chunked execution driven from Node) |
| Bail trigger | Total failures ≥ `maxFailures` |
| `maxFailures` default | `10`, **on by default**; `0` disables (runs everything = today's behavior) |
| `chunkSize` default | `10` (advanced knob; bounds overshoot and per-timeout loss) |
| Execution order | Pre-order traversal identical to `runAll`; chunks are contiguous slices |

## Approach

Replace the single `page.evaluate(runAll)` with a Node-driven loop:

1. Enumerate registered handlers (already done at `index.js:58`), **extended to include
   `children`** so Node can compute execution order.
2. Compute the pre-order test-id list (new pure helper `src/testOrder.js`) mirroring
   `runAll`'s traversal, so chunk boundaries never reorder tests. Matters for stateful apps
   — there is no re-navigation between chunks; the page/app state persists exactly as in a
   single run.
3. For each contiguous chunk of `chunkSize` ids: `page.evaluate` → `runByIds(chunk)` with
   the same `onStart/onPass/onFail/onSkip` callbacks used today; return that chunk's
   `testStatus`. Append to a Node-side `results` array.
4. After each chunk, if `maxFailures > 0` and `failed >= maxFailures`, stop.

Retries are unchanged: a test only counts as failed after `retryCount` attempts are
exhausted (`onFail` fires once, post-retries).

### `.only` handling

If any `.only` is present, `runByIds` reports non-only tests as `skip` (existing runner
behavior in `runSuiteByIds`/`runTest`). Order and failure counts stay correct across
chunks; no special-casing needed.

## Components

### `src/config.js`
Add to `DEFAULT_CONFIG`:
- `maxFailures: 10`
- `chunkSize: 10`

### `src/testOrder.js` (new)
Pure functions, no Puppeteer:
- `orderedTestIds(handlers)` → test ids in `runAll` pre-order (roots in order, DFS children
  in order, `type === 'test'` only).
- `chunk(ids, size)` → array of contiguous slices.

### `src/index.js`
- Extend handler enumeration to include `children`.
- Replace the single evaluate with the chunk loop. Accumulate `results` in a scope visible
  to the `catch`.
- Track `executedCount`, `stoppedEarly`, and `totalTests` (count of `type === 'test'`).
- `hasFailures = stoppedEarly || results.some(fail)`.
- On `stoppedEarly`: **skip contract validation** (partial data → misleading) and say so.
- `catch`: if `results` is non-empty, print the partial summary **before** the diagnostic,
  so a real timeout shows what ran.

### `src/testSummary.js`
`formatRunComplete` gains optional `totalTests`, `stoppedEarly`, `maxFailures`
(backward compatible; existing callers/tests unaffected):
- `Not run: K` line when `totalTests > executed`.
- Early-stop banner:
  ```
  ⚠ Stopped early: reached the failure limit (maxFailures=10).
    18 test(s) were not run. Fix the failures above, or set "maxFailures": 0 to run all.
  ```
- Failed-tests and retried lists unchanged.

### `src/diagnostics.js`
Update the `protocolTimeout` message — it currently claims "the whole test suite runs in a
single page.evaluate call", which is no longer true. New text: a single chunk exceeded
`protocolTimeout` (likely one slow/hanging test); results up to that point are shown above;
raise `protocolTimeout` or lower `chunkSize`.

## Coverage & contracts

- **Coverage:** already skipped whenever there are failures; a bail implies failures, so no
  change is required.
- **Contracts:** skipped on `stoppedEarly` (and on an interrupted/timeout run), with a
  printed note that validation was skipped because the run was incomplete.

## Error handling / data flow

```
loadConfig
  → launch browser, goto url, wait for #twd-sidebar-root
  → enumerate handlers (+children)
  → orderedTestIds → chunk(size)
  → for each chunk:
        results += evaluate(runByIds(chunk))         // survives in Node
        if maxFailures>0 and failed>=maxFailures: stoppedEarly=true; break
  → (not stoppedEarly) contract validation + coverage as today
  → print formatRunComplete(partial-aware)
catch (timeout/crash):
  → if results non-empty: print formatRunComplete(partial) then diagnostic
  → else: diagnostic only (as today)
```

Exit code: `hasFailures` (early bail ⇒ exit 1).

## Testing (vitest, mocked Puppeteer + fs)

- `orderedTestIds` preserves `runAll` order for nested suites; `chunk` slices correctly.
- Bail: failing chunks trip the threshold, loop stops, `Not run` computed, returns
  `true` (failure). Overshoot bounded by `chunkSize`.
- Partial durability: `page.evaluate` throws on the 2nd chunk → partial summary printed +
  diagnostic; results from chunk 1 present.
- `maxFailures: 0` disables bail (all chunks run).
- Clean pass: output and behavior unchanged from today (regression guard).
- Contracts skipped when `stoppedEarly`.

## Rollout

- Minor version bump (new default-on behavior, clearly messaged).
- Regenerate lockfile via `npm run lock:linux` if deps change (they should not here).
- Document `maxFailures` / `chunkSize` in README and `CLAUDE.md`.
