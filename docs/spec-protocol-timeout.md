# Spec: Stop the full suite from dying at puppeteer's 180s `protocolTimeout`

## Problem

`twd-cli` runs the **entire** test suite inside a single `page.evaluate(...)` call
(`src/index.js:58`). Puppeteer maps every `page.evaluate` to one
`Runtime.callFunctionOn` CDP command, and that command is bound by
`protocolTimeout`, which defaults to **180000 ms (180s)**.

When the whole suite takes longer than 180s — common on slow CI runners even
when it passes locally — puppeteer aborts with:

```
Error running tests: ProtocolError: Runtime.callFunctionOn timed out.
Increase the 'protocolTimeout' setting in launch/connect calls for a higher timeout if needed.
```

This is a hard failure with **no per-test output** (the whole batch is lost), so
it looks like a crash rather than a slow suite. Observed in
holafly/web-checkout CI run 26503182725: page loaded at 09:40:46, timed out at
09:43:46 — exactly 180s — while the same suite finishes in ~130s locally.

The current `timeout` config field (default 10000) is **only** passed to
`page.waitForSelector` (`src/index.js:54`), not to puppeteer's protocol layer,
so there is no way to raise the ceiling today.

## Goal

Make the suite robust against the 180s protocol ceiling, and give a clearer
failure mode when a run is genuinely too slow.

## Scope

Two changes, independently shippable. Phase 1 unblocks immediately; Phase 2 is
the durable fix.

### Phase 1 — Configurable `protocolTimeout` (quick, low-risk)

1. Add `protocolTimeout` to `DEFAULT_CONFIG` in `src/config.js`. Default to a
   safe value above the current implicit one, e.g. `300000` (5 min). Document
   that `0` means "no timeout" (puppeteer treats `0` as unlimited).
2. Pass it through to `puppeteer.launch(...)` in `src/index.js:27`:
   ```js
   browser = await puppeteer.launch({
     headless: config.headless,
     args: config.puppeteerArgs,
     protocolTimeout: config.protocolTimeout,
   });
   ```
3. Update `twd.config.example.json`, `README.md`, and `CLAUDE.md` to document
   the new field and explain *why* it exists (whole-suite-in-one-evaluate).

**Acceptance:** a consumer can set `"protocolTimeout": 600000` in
`twd.config.json` and a 200s suite passes in CI.

### Phase 2 — Run tests incrementally, not in one `page.evaluate` (durable)

The deeper issue is that one slow run blows the whole batch and emits no
streamed output. Drive the in-browser `TestRunner` test-by-test (or in bounded
batches) from Node, so each `page.evaluate` is short and bounded by the
per-test `timeout`, not the suite total.

Sketch:
- Expose the test list from the browser first:
  `const tests = await page.evaluate(() => window.__testRunner.list())`
  (add a `list()`/`getTests()` accessor to the runner in `twd-js` if absent).
- Loop in Node, evaluating one test (or a batch of N) per call, collecting
  `testStatus` incrementally and printing results as they complete (matches the
  streamed output `twd-relay` already gives).
- Each call is now bounded by per-test time, so `protocolTimeout` only has to
  cover the slowest single test/batch, not the whole suite.

Benefits: no whole-suite loss on timeout, live progress in CI logs, natural
place to enforce a real per-test timeout and to short-circuit on first failure
if desired.

**Acceptance:** CI logs show per-test pass/fail as the run progresses; a single
hanging test fails only that test (or that batch) instead of the entire run.

## Out of scope

- Parallelizing across multiple pages/browsers.
- Changing `retryCount` semantics.

## Notes for the implementer

- `src/index.js:58-82` is the single `page.evaluate` to refactor for Phase 2.
- `src/config.js` `DEFAULT_CONFIG` (lines 4-13) is where the new field lands.
- Keep Phase 1 even after Phase 2 ships — a generous `protocolTimeout` is still
  a sane safety net for the per-batch calls.
- Tests for this repo live under `tests/`; add config-merge coverage for the new
  field and, for Phase 2, a fixture app with an artificially slow test.
</content>
</invoke>
