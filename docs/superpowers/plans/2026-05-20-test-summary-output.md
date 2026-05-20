# Test Summary Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `twd-cli run` self-describing by printing a final grep-friendly `Tests:` summary line, listing failed test names at the end of the log, and prefixing every contract-validation line with `MOCK ` so it can't be confused with a test-result line.

**Architecture:** Three small pure modules in `src/` (`formatDuration.js`, `testSummary.js`) handle formatting and are unit-tested with no Puppeteer. `src/contractReport.js` gets a one-character-wide change: a `MOCK ` prefix injected before each glyph. `src/index.js` orchestrates: replaces `console.time` with a `Date.now()` delta, calls the new formatters after the existing mock-validation block, prints the summary line and (if any failures) a `Failed tests:` block.

**Tech Stack:** Node.js ESM, vitest for tests, ANSI colors via raw escape codes (matching the style already used in `src/contractReport.js`).

**Spec:** `docs/superpowers/specs/2026-05-20-test-summary-output.md`

---

## File Structure

**New files:**
- `src/formatDuration.js` — pure helper: `formatDuration(ms) -> "m:ss.SSS"`.
- `src/testSummary.js` — pure formatters: `formatTestSummary({ testStatus, durationMs })` returns the one-line `Tests:` string; `formatFailedTestsBlock({ testStatus, handlers })` returns the multi-line failed-tests block (or `null` if there are no failures).
- `tests/formatDuration.test.js`, `tests/testSummary.test.js` — unit tests.

**Modified files:**
- `src/contractReport.js` — add `MOCK ` prefix to all glyph-led lines.
- `src/index.js` — replace `console.time/timeEnd` with manual delta; call the new formatters; print results.
- `tests/contractReport.test.js` — assert every emitted glyph line starts with `MOCK `.
- `tests/runTests.test.js` — one new test that asserts the summary line + failed-tests block are printed.

---

## Task 1: `formatDuration` helper

**Files:**
- Create: `src/formatDuration.js`
- Test: `tests/formatDuration.test.js`

Always emits the `m:ss.SSS` shape the spec example uses (`1:23.193`). Sub-second durations format as `0:00.123`; long durations format as e.g. `12:34.567`. This guarantees a stable column-aligned format across short and long runs.

- [ ] **Step 1: Write the failing test**

Create `tests/formatDuration.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { formatDuration } from '../src/formatDuration.js';

describe('formatDuration', () => {
  it('formats zero as 0:00.000', () => {
    expect(formatDuration(0)).toBe('0:00.000');
  });

  it('formats sub-second durations with leading zero minutes/seconds', () => {
    expect(formatDuration(123)).toBe('0:00.123');
  });

  it('formats single-digit seconds with a leading zero', () => {
    expect(formatDuration(5_678)).toBe('0:05.678');
  });

  it('formats the spec example (83.193s) as 1:23.193', () => {
    expect(formatDuration(83_193)).toBe('1:23.193');
  });

  it('formats a long duration past 10 minutes', () => {
    expect(formatDuration(754_567)).toBe('12:34.567');
  });

  it('pads milliseconds to three digits', () => {
    expect(formatDuration(60_007)).toBe('1:00.007');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/formatDuration.test.js`
Expected: FAIL — `Failed to load url ../src/formatDuration.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/formatDuration.js`:

```javascript
export function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = ms % 1000;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/formatDuration.test.js`
Expected: PASS — 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/formatDuration.js tests/formatDuration.test.js
git commit -m "feat(cli): add formatDuration helper for m:ss.SSS output"
```

---

## Task 2: `formatTestSummary` — the one-line `Tests:` summary

**Files:**
- Create: `src/testSummary.js`
- Test: `tests/testSummary.test.js`

This is the central new piece. Takes a `testStatus` array (the same shape `runTests` already collects: `[{ id, status: 'pass' | 'fail' | 'skip' }]`) plus a `durationMs` number, and returns the single string to print. Colors only the count digits — never the label or words — so `grep "^Tests:"` works even with ANSI present.

- [ ] **Step 1: Write the failing test**

Create `tests/testSummary.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { formatTestSummary } from '../src/testSummary.js';

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('formatTestSummary', () => {
  it('formats an all-pass run', () => {
    const line = formatTestSummary({
      testStatus: [
        { id: '1', status: 'pass' },
        { id: '2', status: 'pass' },
        { id: '3', status: 'pass' },
      ],
      durationMs: 1234,
    });
    expect(stripAnsi(line)).toBe('Tests: 3 passed, 0 failed, 0 skipped (3 total) in 0:01.234');
  });

  it('formats a mixed run', () => {
    const line = formatTestSummary({
      testStatus: [
        { id: '1', status: 'pass' },
        { id: '2', status: 'fail' },
        { id: '3', status: 'skip' },
      ],
      durationMs: 83_193,
    });
    expect(stripAnsi(line)).toBe('Tests: 1 passed, 1 failed, 1 skipped (3 total) in 1:23.193');
  });

  it('formats an empty run', () => {
    const line = formatTestSummary({ testStatus: [], durationMs: 0 });
    expect(stripAnsi(line)).toBe('Tests: 0 passed, 0 failed, 0 skipped (0 total) in 0:00.000');
  });

  it('keeps the "Tests:" label uncolored so grep "^Tests:" matches', () => {
    const line = formatTestSummary({
      testStatus: [{ id: '1', status: 'pass' }],
      durationMs: 1000,
    });
    expect(line.startsWith('Tests:')).toBe(true);
  });

  it('keeps the words "passed", "failed", "skipped" uncolored', () => {
    const line = formatTestSummary({
      testStatus: [
        { id: '1', status: 'pass' },
        { id: '2', status: 'fail' },
      ],
      durationMs: 1000,
    });
    // After stripping ANSI we still get the words; before stripping, the words
    // should not be immediately followed/preceded by an ANSI reset code.
    expect(line).toContain('passed');
    expect(line).toContain('failed');
    // No ANSI code attached to the words themselves.
    expect(/\x1b\[[0-9;]*m(passed|failed|skipped)/.test(line)).toBe(false);
    expect(/(passed|failed|skipped)\x1b\[[0-9;]*m/.test(line)).toBe(false);
  });

  it('colors the passed count green', () => {
    const line = formatTestSummary({
      testStatus: [{ id: '1', status: 'pass' }],
      durationMs: 1000,
    });
    // ANSI 32 = green.
    expect(line).toMatch(/\x1b\[32m1\x1b\[0m passed/);
  });

  it('colors the failed count red only when > 0', () => {
    const lineWithFailures = formatTestSummary({
      testStatus: [
        { id: '1', status: 'pass' },
        { id: '2', status: 'fail' },
      ],
      durationMs: 1000,
    });
    expect(lineWithFailures).toMatch(/\x1b\[31m1\x1b\[0m failed/);

    const lineNoFailures = formatTestSummary({
      testStatus: [{ id: '1', status: 'pass' }],
      durationMs: 1000,
    });
    // 0 failed should not have a red wrapper.
    expect(lineNoFailures).not.toMatch(/\x1b\[31m0\x1b\[0m failed/);
    expect(lineNoFailures).toContain('0 failed');
  });

  it('colors the skipped count yellow only when > 0', () => {
    const lineWithSkips = formatTestSummary({
      testStatus: [
        { id: '1', status: 'pass' },
        { id: '2', status: 'skip' },
      ],
      durationMs: 1000,
    });
    expect(lineWithSkips).toMatch(/\x1b\[33m1\x1b\[0m skipped/);

    const lineNoSkips = formatTestSummary({
      testStatus: [{ id: '1', status: 'pass' }],
      durationMs: 1000,
    });
    expect(lineNoSkips).not.toMatch(/\x1b\[33m0\x1b\[0m skipped/);
    expect(lineNoSkips).toContain('0 skipped');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/testSummary.test.js`
Expected: FAIL — `Failed to load url ../src/testSummary.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/testSummary.js`:

```javascript
import { formatDuration } from './formatDuration.js';

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

export function formatTestSummary({ testStatus, durationMs }) {
  const passed = testStatus.filter((t) => t.status === 'pass').length;
  const failed = testStatus.filter((t) => t.status === 'fail').length;
  const skipped = testStatus.filter((t) => t.status === 'skip').length;
  const total = testStatus.length;

  const passedStr = `${green(passed)} passed`;
  const failedStr = `${failed > 0 ? red(failed) : '0'} failed`;
  const skippedStr = `${skipped > 0 ? yellow(skipped) : '0'} skipped`;

  return `Tests: ${passedStr}, ${failedStr}, ${skippedStr} (${total} total) in ${formatDuration(durationMs)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/testSummary.test.js`
Expected: PASS — 8 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/testSummary.js tests/testSummary.test.js
git commit -m "feat(cli): add formatTestSummary for grep-friendly Tests: line"
```

---

## Task 3: `formatFailedTestsBlock` — names-only block under the summary

**Files:**
- Modify: `src/testSummary.js`
- Modify: `tests/testSummary.test.js`

When there are failures, a block listing just the failing test names appears under the summary so the developer doesn't have to scroll for them. The block returns `null` when there are no failures so the caller can decide whether to print.

The block resolves test names by looking up each failing `testStatus.id` in the `handlers` array (each handler has `{ id, name, type }` — see how `src/index.js:93-95` already does this for the retry block).

- [ ] **Step 1: Write the failing test**

Append to `tests/testSummary.test.js`:

```javascript
import { formatFailedTestsBlock } from '../src/testSummary.js';

describe('formatFailedTestsBlock', () => {
  it('returns null when there are no failures', () => {
    const block = formatFailedTestsBlock({
      testStatus: [{ id: '1', status: 'pass' }],
      handlers: [{ id: '1', name: 'test1', type: 'test' }],
    });
    expect(block).toBeNull();
  });

  it('returns null on an empty run', () => {
    expect(formatFailedTestsBlock({ testStatus: [], handlers: [] })).toBeNull();
  });

  it('lists each failed test by name', () => {
    const block = formatFailedTestsBlock({
      testStatus: [
        { id: '1', status: 'pass' },
        { id: '2', status: 'fail', error: 'boom' },
        { id: '3', status: 'fail', error: 'kaboom' },
      ],
      handlers: [
        { id: '1', name: 'should render', type: 'test' },
        { id: '2', name: 'should submit form', type: 'test' },
        { id: '3', name: 'should show error', type: 'test' },
      ],
    });
    const stripped = stripAnsi(block);
    expect(stripped).toContain('Failed tests:');
    expect(stripped).toContain('should submit form');
    expect(stripped).toContain('should show error');
    // Names preserve the order they came in from testStatus.
    expect(stripped.indexOf('should submit form')).toBeLessThan(stripped.indexOf('should show error'));
  });

  it('falls back to the test id when no matching handler is found', () => {
    const block = formatFailedTestsBlock({
      testStatus: [{ id: 'ghost-id', status: 'fail', error: 'boom' }],
      handlers: [],
    });
    expect(stripAnsi(block)).toContain('ghost-id');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/testSummary.test.js`
Expected: FAIL — `formatFailedTestsBlock is not a function` (it isn't exported yet).

- [ ] **Step 3: Add the implementation**

Append to `src/testSummary.js`:

```javascript
export function formatFailedTestsBlock({ testStatus, handlers }) {
  const failures = testStatus.filter((t) => t.status === 'fail');
  if (failures.length === 0) return null;

  const handlersById = new Map(handlers.map((h) => [h.id, h]));
  const lines = ['Failed tests:'];
  for (const failure of failures) {
    const handler = handlersById.get(failure.id);
    const name = handler ? handler.name : failure.id;
    lines.push(`  ${red('✗')} ${name}`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/testSummary.test.js`
Expected: PASS — 12 tests passing total in this file.

- [ ] **Step 5: Commit**

```bash
git add src/testSummary.js tests/testSummary.test.js
git commit -m "feat(cli): add formatFailedTestsBlock for end-of-log failure list"
```

---

## Task 4: `MOCK ` prefix on contract-validation lines

**Files:**
- Modify: `src/contractReport.js:50,59,64,74`
- Modify: `tests/contractReport.test.js`

Today `src/contractReport.js` prints four kinds of glyph-led lines:
- `:50` — `  ✗ METHOD PATH (STATUS) — mock "..."` (failure)
- `:59` — `  ✓ METHOD PATH (STATUS) — mock "..."` (pass)
- `:64` — `  ⚠ METHOD PATH (STATUS) — mock "..."` (warning)
- `:74` — `  ℹ "alias" — url` (skipped)

We add `MOCK ` between the 2-space indent and the glyph on each, leaving everything else unchanged. The detail / continuation lines that follow (e.g. `:52` `→ path: message` and `:75` reason) are not prefixed — they're already visually subordinate to the prefixed primary line.

- [ ] **Step 1: Write a failing test first**

Append to `tests/contractReport.test.js` (inside the existing `describe('printContractReport', ...)` block):

```javascript
  it('prefixes every glyph-led line with MOCK ', () => {
    const output = {
      results: [
        // pass
        {
          alias: 'getPets',
          url: '/api/v1/pets',
          method: 'GET',
          status: 200,
          specSource: './openapi.json',
          matchedPath: '/v1/pets',
          mode: 'warn',
          validation: { valid: true, errors: [], warnings: [] },
        },
        // fail
        {
          alias: 'createPet',
          url: '/api/v1/pets',
          method: 'POST',
          status: 201,
          specSource: './openapi.json',
          matchedPath: '/v1/pets',
          mode: 'warn',
          validation: {
            valid: false,
            errors: [{ path: 'response.id', message: 'expected integer, got string', keyword: 'type' }],
            warnings: [],
          },
        },
        // warning
        {
          alias: 'serverError',
          url: '/api/v1/pets',
          method: 'GET',
          status: 500,
          specSource: './openapi.json',
          matchedPath: '/v1/pets',
          mode: 'warn',
          validation: {
            valid: true,
            errors: [],
            warnings: [{ type: 'UNMATCHED_STATUS', message: 'Status 500 not documented' }],
          },
        },
      ],
      skipped: [
        { alias: 'untracked', url: '/whatever', reason: 'No matching path in any spec' },
      ],
    };

    printContractReport(output);

    const lines = consoleSpy.mock.calls.map((c) => stripAnsi(c[0]));
    const glyphLines = lines.filter((l) => /^\s*[✓✗⚠ℹ]/.test(l));
    expect(glyphLines.length).toBeGreaterThanOrEqual(4);
    for (const line of glyphLines) {
      expect(line).toMatch(/^\s*MOCK [✓✗⚠ℹ]/);
    }
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/contractReport.test.js`
Expected: FAIL — assertion error on at least one glyph line not starting with `MOCK`.

The test also helps catch regressions in the *existing* tests above — `expect(logs).toContain('✗')` still works because `'  MOCK ✗ POST ...'` still contains `✗`. But we should run them all to confirm.

- [ ] **Step 3: Add the prefix in `src/contractReport.js`**

Edit `src/contractReport.js`. There are four call sites; each needs `MOCK ` injected between the `  ` (2-space indent) and the glyph. Show only the changed strings:

Line ~50 (fail):
```javascript
console.log(failColor(`  MOCK ✗ ${result.method} ${result.matchedPath} (${result.status}) — ${formatMockLabel(result)}`));
```

Line ~59 (pass):
```javascript
console.log(green(`  MOCK ✓ ${result.method} ${result.matchedPath} (${result.status}) — ${formatMockLabel(result)}`));
```

Line ~64 (warning):
```javascript
console.log(yellow(`  MOCK ⚠ ${result.method} ${result.matchedPath} (${result.status}) — ${formatMockLabel(result)}`));
```

Line ~74 (skipped):
```javascript
console.log(dim(`  MOCK ℹ "${skip.alias}" — ${skip.url}`));
```

Leave the detail/continuation lines (`:52`, `:53`, `:65`, `:75`) untouched.

- [ ] **Step 4: Run the contract report tests to verify everything passes**

Run: `npx vitest run tests/contractReport.test.js`
Expected: PASS — all existing tests pass plus the new prefix test.

- [ ] **Step 5: Commit**

```bash
git add src/contractReport.js tests/contractReport.test.js
git commit -m "feat(cli): prefix contract-validation lines with MOCK"
```

---

## Task 5: Wire the new formatters into `runTests`

**Files:**
- Modify: `src/index.js`
- Modify: `tests/runTests.test.js`

This is the integration. We:
1. Remove `console.time('Total Test Time')` / `console.timeEnd(...)` from `src/index.js:32` and `:102`.
2. Capture `const startedAt = Date.now();` right before `page.goto` (`:50`) and `const durationMs = Date.now() - startedAt;` immediately after `runner.runAll()` returns (`:82`).
3. After the contract validation block (`:133`) and any coverage / browser-close steps but *before* `return hasFailures` — print the `Tests:` line, and if a failed-tests block was produced, print it too.

The order on the final log will be:
```
... contract report block ...
Mocks validated: N | Errors: K | Warnings: J | Skipped: M
========================================
Tests: 74 passed, 0 failed, 0 skipped (74 total) in 1:23.193
Failed tests:           (only when there are failures)
  ✗ should submit form
```

- [ ] **Step 1: Write the failing integration test**

Add this test inside the existing `describe("runTests", ...)` block in `tests/runTests.test.js`:

```javascript
  it("should print the Tests: summary line and Failed tests block", async () => {
    const testStatus = [
      { id: '1', status: 'pass' },
      { id: '2', status: 'fail', error: 'boom' },
      { id: '3', status: 'skip' },
    ];
    const handlers = [
      { id: '1', name: 'should render', type: 'test' },
      { id: '2', name: 'should submit form', type: 'test' },
      { id: '3', name: 'should show error', type: 'test' },
    ];
    const page = createMockPage({ handlers, testStatus });
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runTests();

    const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const logs = consoleSpy.mock.calls.map((c) => stripAnsi(String(c[0])));

    const summaryLine = logs.find((l) => l.startsWith('Tests:'));
    expect(summaryLine).toBeDefined();
    expect(summaryLine).toMatch(/^Tests: 1 passed, 1 failed, 1 skipped \(3 total\) in \d+:\d{2}\.\d{3}$/);

    const failedHeader = logs.find((l) => l === 'Failed tests:');
    expect(failedHeader).toBeDefined();
    expect(logs.some((l) => l.includes('should submit form'))).toBe(true);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/runTests.test.js`
Expected: FAIL — `summaryLine` is `undefined` (the source hasn't printed it yet).

- [ ] **Step 3: Update `src/index.js`**

Open `src/index.js`. Make the following changes (line numbers refer to the current file):

**a) Add the imports** near the top (after the existing imports, around `:9`):

```javascript
import { formatTestSummary, formatFailedTestsBlock } from './testSummary.js';
```

**b) Replace `console.time('Total Test Time')` (`:32`) with a captured timestamp.** Delete that line and instead capture the start time right before `await page.goto(config.url);` (currently `:50`):

```javascript
const startedAt = Date.now();
console.log(`Navigating to ${config.url} ...`);
await page.goto(config.url);
```

**c) Capture the duration right after `runner.runAll()` returns.** The destructuring assignment is currently at `:57-81` and ends at `:81` with the closing `}, config.retryCount);`. Immediately after that, add:

```javascript
const durationMs = Date.now() - startedAt;
```

**d) Delete the `console.timeEnd('Total Test Time');` call** that is currently around `:102`. (It is between the retry-summary block and the `// Enrich collected mocks ...` comment.)

**e) Print the new summary at the very end, just before `return hasFailures;`.** After the existing coverage block ends (around `:156`) and before `await browser.close();` — actually, putting it before `browser.close()` is awkward visually. The cleanest spot is between the coverage block and `await browser.close()`. That way the order is: contract block → mock summary → coverage status → `Tests:` line → `Failed tests:` block → "Browser closed." log → return. Here is the snippet to insert right before the `await browser.close();` line:

```javascript
console.log('');
console.log(formatTestSummary({ testStatus, durationMs }));
const failedBlock = formatFailedTestsBlock({ testStatus, handlers });
if (failedBlock) {
  console.log(failedBlock);
}
```

The leading blank line gives breathing room between the previous block and the summary.

- [ ] **Step 4: Run the runTests tests to verify the new one passes**

Run: `npx vitest run tests/runTests.test.js`
Expected: PASS — all existing tests still pass; the new summary-line test passes.

- [ ] **Step 5: Run the full test suite to catch regressions**

Run: `npm run test:ci`
Expected: PASS — every test in `tests/` passes; coverage report still emitted.

- [ ] **Step 6: Commit**

```bash
git add src/index.js tests/runTests.test.js
git commit -m "feat(cli): print Tests: summary line and Failed tests block"
```

---

## Task 6: Manual verification with `test-example-app`

**Files:** none modified — this is a smoke test.

The unit + integration tests cover format correctness. This task confirms the wiring works end-to-end against a real browser run. The repo already ships a `test-example-app/` for exactly this purpose (see `CLAUDE.md`).

- [ ] **Step 1: Start the example app**

```bash
cd test-example-app
npm install   # if not done already
npm run dev
```

Leave the dev server running. It serves the demo React app on its configured port (check the dev server output for the actual URL — typically `http://localhost:5173`).

- [ ] **Step 2: In a separate terminal, run twd-cli against the example app**

From the repo root:

```bash
npm run execute:cli -- run
```

Or equivalently `node ./bin/twd-cli.js run`.

- [ ] **Step 3: Inspect the tail of the output**

You should see, at the bottom:

```
========================================
                                          (blank line)
Tests: <N> passed, 0 failed, 0 skipped (<N> total) in <0:M.SSS>
Browser closed.
```

`grep "^Tests:"` against the captured output should return exactly one line.

- [ ] **Step 4: Verify a failure case**

Edit any test in `test-example-app/src/` (or its TWD test file) to make it fail — flip an assertion. Re-run `npm run execute:cli -- run`. You should now see:

```
Tests: <N-1> passed, 1 failed, 0 skipped (<N> total) in <0:M.SSS>
Failed tests:
  ✗ <the test name>
```

The exit code should be non-zero (`echo $?` after the run prints `1`).

- [ ] **Step 5: Verify the MOCK prefix**

If `test-example-app` has contract-validation configured, look for `MOCK ✓`, `MOCK ✗`, `MOCK ⚠`, or `MOCK ℹ` lines in the contract report block. If it does not (no `contracts` in `twd.config.json`), this verification is satisfied by the unit test in Task 4.

- [ ] **Step 6: Revert the deliberate failure**

```bash
git checkout test-example-app/
```

(Or undo the assertion flip manually.) Run `npm run execute:cli -- run` one more time and confirm the suite is green again.

- [ ] **Step 7: No commit required** — this task only verifies.

---

## Verification checklist (run before opening a PR)

- [ ] `npm run test:ci` — all green, coverage emitted.
- [ ] Manual smoke against `test-example-app` shows the `Tests:` line and (when forced) the `Failed tests:` block.
- [ ] `grep "^Tests:"` against captured raw output returns exactly one line.
- [ ] Contract report lines all start with `MOCK ` after their indent.
- [ ] The standalone `Total Test Time:` line is gone (replaced by the duration on the `Tests:` line).
