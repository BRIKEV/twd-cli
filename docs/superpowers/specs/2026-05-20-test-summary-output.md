# twd-cli Test Summary Output — Design Spec

**Date:** 2026-05-20
**Status:** Proposed

## Purpose

Make the final output of `twd-cli run` self-describing: at a glance, a developer (or an AI agent piping the output through `grep`) should be able to tell **how many tests passed, how many failed, how many were skipped** — without parsing per-test lines or running the suite again.

Today the run ends with a mock-validation summary like:

```
Mocks validated: 128 | Errors: 7 | Warnings: 0 | Skipped: 80
```

That line is about *mocks*, not *tests*. There is no equivalent line for test results. Users reading the tail of the log have to scroll back and visually count `✓ should ...` lines, and they may confuse the yellow `✗ … mock "fetchCart"` contract-warning lines with failing tests (same glyph, similar position).

## Problem (real session)

While running a long suite headless via `npm run test:ci`, the consuming agent re-ran the suite ~5 times trying to confirm "did all tests pass?" because:

1. No final `Tests: N passed, M failed, K skipped` line exists.
2. The yellow `✗` glyph used for *mock contract validation failures* looks identical to a failed test marker.
3. ANSI color codes broke naive `grep "✓ should"` patterns, so attempts to count from the log returned 0.

Each re-run was ~1:23, so the cost of "I can't tell if it passed" was ~7 minutes of wall time.

## Scope

**In scope:**
- A final, single-line test summary printed after all tests complete.
- Visual disambiguation between *test result* lines and *mock contract validation* lines.
- A machine-friendly summary line (stable format, easy to grep without ANSI gymnastics).

**Out of scope:**
- Changing the per-test output format itself.
- Reworking the mock-validation summary line (the line that exists today is fine — it just needs to not be the *only* summary).
- A `--summary` / quiet reporter mode — deferred to a follow-up.
- JUnit XML / JSON reporter output — deferred to a follow-up.

## Proposed Solution

### 1. Add a final test summary line

After all tests finish (and after the mock-validation summary), print:

```
Tests:   74 passed, 0 failed, 0 skipped (74 total) in 1:23.193
```

Format requirements:
- One line.
- Stable label `Tests:` at the start so it's grep-friendly.
- Colors only on the count digits (green for passed, red for failed if > 0, yellow for skipped if > 0). The label `Tests:` and the words `passed` / `failed` / `skipped` stay uncolored so `grep "^Tests:"` works regardless of ANSI handling.
- Duration in the same `m:ss.SSS` format the runner shows today.

**Duration source.** Today `src/index.js` uses `console.time('Total Test Time')` / `console.timeEnd(...)` to print `Total Test Time: 1:23.193` as its own line. That call's output is not capturable as a value. Replace it with a manual `Date.now()` delta captured around the same span (start before `page.goto`, end after `runner.runAll()` returns), formatted to the same `m:ss.SSS` string. The standalone `Total Test Time:` line is removed; the duration appears only on the `Tests:` line. This keeps the log to one canonical timing line.

When there are failures, also print a `Failed tests:` block with just the test names (no stack traces — those already appear inline above), so the developer can see the names at the end of the log without scrolling.

### 2. Disambiguate mock-validation lines from test result lines

The current mock contract output (`src/contractReport.js`) uses `✓` for passing mocks, `✗` for failing ones, and `⚠` for warnings. The `✗` glyph collides visually with the `✗` used for failed tests in the suite tree printed by `reportResults` (`twd-js/runner-ci`). Color helps in warn-mode contract failures (yellow) but not in error-mode (red — same as test failures), and color is fragile under `grep`/CI log viewers.

**Decision:** add a `MOCK ` prefix to every line that comes out of `contractReport.js`. The existing glyph assignments stay (`✓` pass, `✗` fail, `⚠` warning) — they are correct *within* the contract report; the prefix is what distinguishes contract lines from test-result lines.

Example before:
```
  ✗ GET /v1/carts/{cart_id} (200) — mock "fetchCart" — in "Checkout New — Redis ID Flow > ..."
```

Example after:
```
  MOCK ✗ GET /v1/carts/{cart_id} (200) — mock "fetchCart" — in "Checkout New — Redis ID Flow > ..."
```

Apply the prefix uniformly to all four line kinds the report can emit: pass (`✓`), fail (`✗`), warning (`⚠`), and skipped (`ℹ`). Indentation already exists; the prefix sits between the indentation and the glyph.

## Exit Code Behavior

No change. Exit code already reflects test failures plus `mode: "error"` contract failures (`src/index.js:101,119`).

**Interplay with the `Tests:` line.** The new `Tests:` summary counts test outcomes *only* (pass/fail/skip from `testStatus`). A run can legitimately exit non-zero while `Tests:` reads `0 failed` — that means every test passed but at least one mock failed contract validation in `error` mode. The mock summary line (`Mocks validated: … | Errors: N | …`) and the contract report block above it are the canonical place to see contract failures; the `Tests:` line is not retroactively edited to fold them in.

## Testing Strategy

- Unit test the summary formatter directly: given a `testStatus` array with a known mix (e.g. 3 pass, 1 fail, 1 skip) and a duration value, assert the `Tests:` line matches the expected format. Keep this layer pure (no Puppeteer) so the format is easy to lock down.
- Unit test the failed-tests block: given a `testStatus` array with two failures and a `handlers` array, assert both names appear under `Failed tests:` in the order the suite produced them.
- Extend the existing `contractReport.test.js` to assert every emitted line starts with `MOCK ` (after any leading whitespace). Cover all four line kinds: pass, fail, warning, skipped.
- Verify `grep "^Tests:"` against a raw run (ANSI included) returns exactly one line — i.e. the label is not wrapped in escape sequences. (The count digits themselves may carry color codes; the label must not.)

## Benefits

- **Faster developer feedback:** one line at the end answers "did it pass?" — no scrolling, no counting.
- **AI-agent friendly:** stable, grep-able summary line. Avoids re-running long suites just to confirm a result.
- **Less confusion between mocks and tests:** the `MOCK ` prefix removes the "is that a test failure or a mock warning?" question.

## Notes / Open Questions

- Should the failed-test block at the end include the file path + line number for each failure, or just the test name? (Stack traces already appear inline above.) Default for the implementation plan: **just the test name**, mirroring what the per-test line shows. Revisit if it proves too thin.

## Follow-up Work (Out of Scope Here)

- **`--summary` / quiet reporter.** A mode that suppresses per-request mock log lines (which dominate output for large suites) and prints only RUN/PASS/FAIL per test, the `Tests:` line, the mock-validation summary line, and the contract report path. Likely shaped as a `twd.config.json` field (`reporter: "summary"`) for consistency with how other twd-cli behavior is configured, not a CLI flag.
- **`--json` reporter** for CI dashboards. The summary-line work in this spec makes this trivial later.
