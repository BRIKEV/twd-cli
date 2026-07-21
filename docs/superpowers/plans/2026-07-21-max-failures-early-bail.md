# Fail-fast Early Bail + Durable Partial Results — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `twd-cli` stop a run once too many tests have failed, and never lose already-gathered results when a run times out or crashes.

**Architecture:** Replace the single whole-suite `page.evaluate(runAll)` with a Node-driven loop that runs tests in ordered chunks via `runByIds`, accumulating results in Node after each chunk. After each chunk, stop if total failures ≥ `maxFailures`. Results live in Node, so a chunk timeout/crash still prints what completed. `twd-cli`-only; `twd-js` is untouched.

**Tech Stack:** Node.js ESM, Puppeteer, Vitest (mocked `fs` + `puppeteer`).

## Global Constraints

- **Scope:** `twd-cli` only. Do **not** modify `twd-js` / the `TestRunner` class. Rely only on `runByIds`, the handler enumeration, and existing config.
- **Bail trigger:** cumulative **total** failures (`results.filter(status==='fail').length >= maxFailures`). No "consecutive" logic.
- **`maxFailures` default:** `10`, on by default. `0` disables bail (runs everything = today's behavior).
- **`chunkSize` default:** `10`. `<= 0` is treated as a single chunk (run everything at once).
- **Ordering contract:** the handler enumeration (`Array.from(window.__TWD_STATE__.handlers.values())`) is in insertion order, and twd inserts a suite before its children, so `filter(h => h.type === 'test')` is already pre-order execution order. `runByIds` runs a subset in that same tree order. Chunks are contiguous slices of that ordered id list.
- **Runtime:** ESM only, Node `>=18`. No new dependencies (so `npm run lock:linux` is not required for this work).
- **Commits:** Conventional Commits; this repo (`brikev/**`) keeps the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

## File Structure

- `src/config.js` (modify) — add `maxFailures`, `chunkSize` defaults.
- `src/testOrder.js` (create) — pure helpers `orderedTestIds(handlers)` and `chunk(items, size)`.
- `src/testSummary.js` (modify) — `formatRunComplete` gains optional `notRun`, `stoppedEarly`, `maxFailures`.
- `src/diagnostics.js` (modify) — reword the `protocolTimeout` explanation for the chunked model.
- `src/index.js` (modify) — chunked run loop, Node-side accumulation, bail, skip contracts on early stop, partial print on crash.
- `README.md`, `CLAUDE.md` (modify) — document the two config keys.
- Tests: `tests/config.test.js`, `tests/testOrder.test.js` (new), `tests/testSummary.test.js`, `tests/diagnostics.test.js`, `tests/runTests.test.js`.

---

### Task 1: Config defaults (`maxFailures`, `chunkSize`)

**Files:**
- Modify: `src/config.js:4-14` (`DEFAULT_CONFIG`)
- Test: `tests/config.test.js`

**Interfaces:**
- Produces: `loadConfig()` returned object now includes `maxFailures: number` (default `10`) and `chunkSize: number` (default `10`), overridable from `twd.config.json`.

- [ ] **Step 1: Update the default-config test expectations**

In `tests/config.test.js`, add the two keys to every full-object `toEqual`. There are three: the "load default config" test (~line 26), the "merge user config" test (~line 51), and the "invalid JSON" test (~line 97). Add to each expected object:

```js
      retryCount: 2,
      protocolTimeout: 300000,
      maxFailures: 10,
      chunkSize: 10,
    });
```

In the "override all default values" test (~line 68), add the two keys to the `userConfig` object so the full-override assertion still holds:

```js
      retryCount: 3,
      protocolTimeout: 600000,
      maxFailures: 5,
      chunkSize: 20,
    };
```

- [ ] **Step 2: Add a focused test for the new defaults and overrides**

Append inside the `describe('loadConfig', ...)` block in `tests/config.test.js`:

```js
  it('defaults maxFailures to 10 and chunkSize to 10', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const config = loadConfig();
    expect(config.maxFailures).toBe(10);
    expect(config.chunkSize).toBe(10);
  });

  it('allows user to override maxFailures and chunkSize (0 disables bail)', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ maxFailures: 0, chunkSize: 25 })
    );
    const config = loadConfig();
    expect(config.maxFailures).toBe(0);
    expect(config.chunkSize).toBe(25);
  });
```

- [ ] **Step 3: Run the config tests to verify they fail**

Run: `npx vitest run tests/config.test.js`
Expected: FAIL — defaults object does not yet include `maxFailures`/`chunkSize`.

- [ ] **Step 4: Add the defaults to `DEFAULT_CONFIG`**

In `src/config.js`, extend `DEFAULT_CONFIG`:

```js
const DEFAULT_CONFIG = {
  url: 'http://localhost:5173',
  timeout: 10000,
  coverage: true,
  coverageDir: './coverage',
  nycOutputDir: './.nyc_output',
  headless: true,
  puppeteerArgs: ['--no-sandbox', '--disable-setuid-sandbox'],
  retryCount: 2,
  protocolTimeout: 300000,
  maxFailures: 10,
  chunkSize: 10,
};
```

- [ ] **Step 5: Run the config tests to verify they pass**

Run: `npx vitest run tests/config.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config.js tests/config.test.js
git commit -m "feat: add maxFailures and chunkSize config defaults

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Ordering + chunking helpers (`src/testOrder.js`)

**Files:**
- Create: `src/testOrder.js`
- Test: `tests/testOrder.test.js` (create)

**Interfaces:**
- Produces:
  - `orderedTestIds(handlers: Array<{id, type, parent?}>) => string[]` — ids of `type === 'test'` handlers, in enumeration (pre-order) order.
  - `chunk(items: T[], size: number) => T[][]` — contiguous slices of `size`; `size <= 0` returns a single chunk `[items]` (empty input returns `[]`).

- [ ] **Step 1: Write the failing tests**

Create `tests/testOrder.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { orderedTestIds, chunk } from '../src/testOrder.js';

describe('orderedTestIds', () => {
  it('returns test ids in enumeration order, skipping suites', () => {
    const handlers = [
      { id: 's1', type: 'suite' },
      { id: 't1', type: 'test', parent: 's1' },
      { id: 's2', type: 'suite', parent: 's1' },
      { id: 't2', type: 'test', parent: 's2' },
      { id: 't3', type: 'test', parent: 's1' },
    ];
    expect(orderedTestIds(handlers)).toEqual(['t1', 't2', 't3']);
  });

  it('returns an empty array when there are no tests', () => {
    expect(orderedTestIds([{ id: 's1', type: 'suite' }])).toEqual([]);
    expect(orderedTestIds([])).toEqual([]);
  });
});

describe('chunk', () => {
  it('splits into contiguous slices of the given size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns a single chunk when size <= 0', () => {
    expect(chunk([1, 2, 3], 0)).toEqual([[1, 2, 3]]);
    expect(chunk([1, 2, 3], -4)).toEqual([[1, 2, 3]]);
  });

  it('returns an empty array for empty input', () => {
    expect(chunk([], 10)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/testOrder.test.js`
Expected: FAIL with "Failed to resolve import '../src/testOrder.js'".

- [ ] **Step 3: Implement the helpers**

Create `src/testOrder.js`:

```js
// The handler enumeration preserves insertion order, and twd registers each
// suite before its children, so filtering to tests yields pre-order execution
// order — the same order runByIds/runAll walk the tree in.
export function orderedTestIds(handlers) {
  return handlers.filter((h) => h.type === 'test').map((h) => h.id);
}

// Split items into contiguous slices of `size`. size <= 0 means "one chunk".
export function chunk(items, size) {
  if (size <= 0) return items.length ? [items.slice()] : [];
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/testOrder.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/testOrder.js tests/testOrder.test.js
git commit -m "feat: add test ordering and chunking helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Summary output — `Not run` line + early-stop banner

**Files:**
- Modify: `src/testSummary.js`
- Test: `tests/testSummary.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `formatRunComplete({ testStatus, handlers, durationMs, notRun?, stoppedEarly?, maxFailures? })`. New params are optional and default to no-ops (`notRun = 0`, `stoppedEarly = false`), so existing callers are unaffected. When `notRun > 0` a `  Not run: K` line is added; when `stoppedEarly` is true an early-stop banner is appended last.

- [ ] **Step 1: Write the failing tests**

Append to `tests/testSummary.test.js` inside the `describe('formatRunComplete', ...)` block:

```js
  it('adds a "Not run" line when notRun > 0', () => {
    const block = formatRunComplete({
      testStatus: [{ id: 't1', status: 'pass' }],
      handlers,
      durationMs: 1000,
      notRun: 3,
    });
    expect(block).toContain('  Not run: 3');
  });

  it('omits the "Not run" line when notRun is 0', () => {
    const block = formatRunComplete({
      testStatus: [{ id: 't1', status: 'pass' }],
      handlers,
      durationMs: 1000,
    });
    expect(block).not.toContain('Not run');
  });

  it('appends an early-stop banner when stoppedEarly is true', () => {
    const block = formatRunComplete({
      testStatus: [
        { id: 't1', status: 'fail', error: 'boom' },
        { id: 't2', status: 'fail', error: 'boom' },
      ],
      handlers,
      durationMs: 1000,
      notRun: 5,
      stoppedEarly: true,
      maxFailures: 2,
    });
    expect(block).toContain('Stopped early');
    expect(block).toContain('maxFailures=2');
    expect(block).toContain('5 test(s) were not run');
    expect(block).toContain('"maxFailures": 0');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/testSummary.test.js`
Expected: FAIL — no `Not run` line / banner yet.

- [ ] **Step 3: Implement the additions**

Replace the body of `formatRunComplete` in `src/testSummary.js` with:

```js
export function formatRunComplete({
  testStatus,
  handlers,
  durationMs,
  notRun = 0,
  stoppedEarly = false,
  maxFailures,
}) {
  const passed = testStatus.filter((t) => t.status === 'pass').length;
  const failed = testStatus.filter((t) => t.status === 'fail').length;
  const skipped = testStatus.filter((t) => t.status === 'skip').length;
  const duration = (durationMs / 1000).toFixed(1);

  const lines = [
    '--- Run complete ---',
    `  Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped}`,
  ];
  if (notRun > 0) lines.push(`  Not run: ${notRun}`);
  lines.push(`  Duration: ${duration}s`);

  const failures = testStatus.filter((t) => t.status === 'fail');
  if (failures.length > 0) {
    lines.push('', `  Failed tests (${failures.length}):`);
    for (const failure of failures) {
      const testPath = buildTestPath(failure.id, handlers) ?? failure.id;
      lines.push(`    × ${testPath}`);
      if (failure.error) {
        lines.push(`      ${String(failure.error).replace(/\n/g, '\n      ')}`);
      }
    }
  }

  const retried = testStatus.filter((t) => t.status === 'pass' && t.retryAttempt >= 2);
  if (retried.length > 0) {
    lines.push('', `  Retried (${retried.length}):`);
    for (const t of retried) {
      const testPath = buildTestPath(t.id, handlers) ?? t.id;
      lines.push(`    ✓ ${testPath} (passed on attempt ${t.retryAttempt})`);
    }
  }

  if (stoppedEarly) {
    lines.push(
      '',
      `⚠ Stopped early: reached the failure limit (maxFailures=${maxFailures}).`,
      `  ${notRun} test(s) were not run. Fix the failures above, or set "maxFailures": 0 to run all.`
    );
  }

  return lines.join('\n');
}
```

Leave the `import { buildTestPath }` line at the top of the file unchanged.

- [ ] **Step 4: Run the full summary suite to verify pass + no regression**

Run: `npx vitest run tests/testSummary.test.js`
Expected: PASS — new tests pass and the existing exact-block assertions (all-pass, failures, retried) are unchanged because `notRun`/`stoppedEarly` default off.

- [ ] **Step 5: Commit**

```bash
git add src/testSummary.js tests/testSummary.test.js
git commit -m "feat: show Not-run count and early-stop banner in run summary

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Reword the `protocolTimeout` diagnostic

**Files:**
- Modify: `src/diagnostics.js:31-37`
- Test: `tests/diagnostics.test.js:43-49`

**Interfaces:** no signature change. The returned string must still contain the substrings `protocolTimeout` and `twd.config.json` (asserted by both `tests/diagnostics.test.js` and the `runTests` timeout test).

- [ ] **Step 1: Update the existing diagnostic test to assert the new wording**

Replace the "explains protocol timeouts" test in `tests/diagnostics.test.js` (~line 43) with:

```js
  it('explains protocol timeouts', () => {
    const err = new Error('Runtime.callFunctionOn timed out.');
    err.name = 'ProtocolError';
    const msg = explainError(err, config);
    expect(msg).toContain('protocolTimeout');
    expect(msg).toContain('twd.config.json');
    expect(msg).toContain('chunkSize');
  });
```

- [ ] **Step 2: Run the diagnostics test to verify it fails**

Run: `npx vitest run tests/diagnostics.test.js`
Expected: FAIL — current message does not mention `chunkSize`.

- [ ] **Step 3: Reword the message**

In `src/diagnostics.js`, replace the `isProtocolTimeout(error)` branch return in `explainError`:

```js
  if (isProtocolTimeout(error)) {
    return (
      'A single chunk of tests exceeded Puppeteer\'s protocolTimeout — usually one very\n' +
      'slow or hanging test. Any results printed above are partial (from chunks that\n' +
      'finished). Raise "protocolTimeout" in twd.config.json (0 = no timeout), or lower\n' +
      '"chunkSize" so less work rides on each call.'
    );
  }
```

- [ ] **Step 4: Run the diagnostics test to verify it passes**

Run: `npx vitest run tests/diagnostics.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/diagnostics.js tests/diagnostics.test.js
git commit -m "docs: reword protocolTimeout diagnostic for chunked runs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Chunked execution refactor (behavior-preserving)

Convert the single whole-suite `page.evaluate` into a chunked loop that runs `runByIds` per chunk and accumulates results in Node. No bail yet — every chunk runs, so behavior matches today. The chunk `evaluate` now returns a **test-status array** (not `{handlers, testStatus}`); handlers for the summary come from the enumeration.

**Files:**
- Modify: `src/index.js` (imports + the run section, roughly current lines 95-122, 130-134, 187-189)
- Test: `tests/runTests.test.js`

**Interfaces:**
- Consumes: `orderedTestIds`, `chunk` from `src/testOrder.js`; `loadConfig()` fields `chunkSize`, `retryCount`.
- Produces: unchanged public surface — `runTests(options?) => Promise<boolean>`. Internally, each run `page.evaluate` is called as `(fn, retryCount, ids)` where `ids` is a concrete id array (never `null`).

- [ ] **Step 1: Update the run-flow test harness for chunked returns**

In `tests/runTests.test.js`:

(a) Add the two new keys to `defaultMockConfig` (use a large `chunkSize` so every existing fixture is a single chunk, and keep bail effectively off for these tests):

```js
const defaultMockConfig = {
  url: 'http://localhost:5173',
  timeout: 10000,
  coverage: false,
  coverageDir: './coverage',
  nycOutputDir: './.nyc_output',
  headless: true,
  puppeteerArgs: [],
  retryCount: 2,
  maxFailures: 10,
  chunkSize: 50,
};
```

(b) Replace `createMockPage` so a chunk call resolves to a **testStatus array**:

```js
function createMockPage({ handlers = [], testStatus = [] } = {}) {
  return {
    goto: vi.fn(),
    waitForSelector: vi.fn(),
    evaluate: vi.fn()
      .mockResolvedValueOnce(handlers) // enumeration pass returns handler metadata
      .mockResolvedValue(testStatus),  // each chunk run returns its testStatus array
    exposeFunction: vi.fn(),
  };
}
```

(c) Update the two signature assertions that expected `null`:
- In "should pass retryCount to page.evaluate": change `toHaveBeenCalledWith(expect.any(Function), 3, null)` to `toHaveBeenCalledWith(expect.any(Function), 3, ['1'])`.
- In "passes selectedIds=null to the run evaluate when no filter": change `toHaveBeenCalledWith(expect.any(Function), 2, null)` to `toHaveBeenCalledWith(expect.any(Function), 2, ['1'])`, and update the test title to `"passes all test ids to the run evaluate when no filter"`.

(d) In the "preserves responseHeaders" test, the mocked `page.evaluate` implementation currently returns `{ handlers, testStatus }`. Change its final line to return the array:

```js
          return testStatus;
```

(e) In the three filter tests ("runs only matching tests…", "warns about filters…", "skips coverage collection when a filter is active"), each builds a `runResult = { handlers: registry, testStatus: [...] }` and mocks the 2nd evaluate with it. Change each 2nd-evaluate mock to resolve the array directly, e.g.:

```js
      evaluate: vi.fn()
        .mockResolvedValueOnce(registry)                    // enumeration pass
        .mockResolvedValueOnce([{ id: 't1', status: 'pass' }]), // chunk run pass
```

Delete the now-unused `runResult` locals in those three tests. Leave every `toHaveBeenNthCalledWith(2, expect.any(Function), 2, ['t1'])` assertion as-is (a single filtered id is one chunk).

- [ ] **Step 2: Run the run-flow tests to verify they fail**

Run: `npx vitest run tests/runTests.test.js`
Expected: FAIL — `src/index.js` still returns/handles `{handlers, testStatus}` from a single evaluate.

- [ ] **Step 3: Add the imports**

In `src/index.js`, add after the existing imports:

```js
import { orderedTestIds, chunk } from './testOrder.js';
```

- [ ] **Step 4: Replace the single run evaluate with a chunked loop**

In `src/index.js`, replace the block that currently runs the whole suite (the `const { handlers, testStatus } = await page.evaluate(...)` call through the `const durationMs = ...` line) with:

```js
    // Resolve the ordered id list to run: the filter result, or all tests.
    const baseIds = selectedIds ?? orderedTestIds(registeredHandlers);
    const chunks = chunk(baseIds, config.chunkSize);

    // Handlers for path-building/summary come from the enumeration so partial
    // results are always printable even if a chunk never returns.
    const handlers = registeredHandlers;
    const testStatus = [];
    let executed = 0;

    for (const ids of chunks) {
      const chunkStatus = await page.evaluate(async (retryCount, chunkIds) => {
        const TestRunner = window.__testRunner;
        const testStatus = [];
        const runner = new TestRunner({
          onStart: (test) => {
            test.status = "running";
          },
          onPass: (test, retryAttempt) => {
            test.status = "done";
            const entry = { id: test.id, status: "pass" };
            if (retryAttempt !== undefined) entry.retryAttempt = retryAttempt;
            testStatus.push(entry);
          },
          onFail: (test, err) => {
            test.status = "done";
            testStatus.push({ id: test.id, status: "fail", error: `${err.message} (at ${window.location.href})` });
          },
          onSkip: (test) => {
            test.status = "done";
            testStatus.push({ id: test.id, status: "skip" });
          },
        }, { retryCount });
        await runner.runByIds(chunkIds);
        return testStatus;
      }, config.retryCount, ids);

      testStatus.push(...chunkStatus);
      executed += ids.length;
    }

    const durationMs = Date.now() - startedAt;
    const notRun = baseIds.length - executed;
```

- [ ] **Step 5: Point the summary + contract enrichment at the enumeration handlers**

The replacement in Step 4 already defines `const handlers = registeredHandlers;`, so the existing `buildTestPath(mock.testId, handlers)` (contract enrichment loop) and the final `formatRunComplete({ testStatus, handlers, durationMs })` call keep working unchanged. Leave the final summary call as-is for this task:

```js
    console.log('');
    console.log(formatRunComplete({ testStatus, handlers, durationMs }));
```

- [ ] **Step 6: Run the run-flow tests to verify they pass**

Run: `npx vitest run tests/runTests.test.js`
Expected: PASS.

- [ ] **Step 7: Run the whole suite to confirm no cross-file regression**

Run: `npm run test:ci`
Expected: PASS (all files).

- [ ] **Step 8: Commit**

```bash
git add src/index.js tests/runTests.test.js
git commit -m "refactor: run tests in Node-driven chunks via runByIds

Accumulate results in Node per chunk instead of one whole-suite
page.evaluate. Behavior-preserving; sets up early-bail and durable
partial results.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Early bail on `maxFailures`

Stop the chunk loop once total failures reach `maxFailures`, report `Not run` and the banner, and skip contract validation on an incomplete run.

**Files:**
- Modify: `src/index.js` (the chunk loop from Task 5, the contracts block, the summary call)
- Test: `tests/runTests.test.js`

**Interfaces:**
- Consumes: `config.maxFailures`.
- Produces: `runTests` returns `true` when it stops early; prints the early-stop summary; does not run contract validation when `stoppedEarly`.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('runTests', ...)` block in `tests/runTests.test.js`:

```js
  it("stops early once maxFailures is reached and reports Not run", async () => {
    const handlers = [
      { id: 's1', name: 'Suite', type: 'suite' },
      { id: 't1', name: 't1', parent: 's1', type: 'test' },
      { id: 't2', name: 't2', parent: 's1', type: 'test' },
      { id: 't3', name: 't3', parent: 's1', type: 'test' },
      { id: 't4', name: 't4', parent: 's1', type: 'test' },
      { id: 't5', name: 't5', parent: 's1', type: 'test' },
    ];
    const page = {
      goto: vi.fn(),
      waitForSelector: vi.fn(),
      exposeFunction: vi.fn(),
      evaluate: vi.fn()
        .mockResolvedValueOnce(handlers)                             // enumeration
        .mockResolvedValueOnce([{ id: 't1', status: 'fail', error: 'a' }]) // chunk 1
        .mockResolvedValueOnce([{ id: 't2', status: 'fail', error: 'b' }]), // chunk 2
    };
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig,
      maxFailures: 2,
      chunkSize: 1,
    });

    const result = await runTests();

    expect(result).toBe(true);
    // enumeration + exactly 2 chunks (stopped; did NOT run t3..t5)
    expect(page.evaluate).toHaveBeenCalledTimes(3);
    const block = consoleSpy.mock.calls.map((c) => String(c[0])).at(-1);
    expect(block).toContain('Not run: 3');
    expect(block).toContain('Stopped early');
    expect(block).toContain('maxFailures=2');
  });

  it("runs every chunk when maxFailures is 0 (bail disabled)", async () => {
    const handlers = [
      { id: 's1', name: 'Suite', type: 'suite' },
      { id: 't1', name: 't1', parent: 's1', type: 'test' },
      { id: 't2', name: 't2', parent: 's1', type: 'test' },
      { id: 't3', name: 't3', parent: 's1', type: 'test' },
    ];
    const page = {
      goto: vi.fn(),
      waitForSelector: vi.fn(),
      exposeFunction: vi.fn(),
      evaluate: vi.fn()
        .mockResolvedValueOnce(handlers)
        .mockResolvedValue([{ id: 'x', status: 'fail', error: 'boom' }]),
    };
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig,
      maxFailures: 0,
      chunkSize: 1,
    });

    await runTests();

    // enumeration + 3 chunks; never bailed
    expect(page.evaluate).toHaveBeenCalledTimes(4);
  });

  it("skips contract validation when the run stops early", async () => {
    const handlers = [
      { id: 's1', name: 'Suite', type: 'suite' },
      { id: 't1', name: 't1', parent: 's1', type: 'test' },
      { id: 't2', name: 't2', parent: 's1', type: 'test' },
    ];
    const page = {
      goto: vi.fn(),
      waitForSelector: vi.fn(),
      exposeFunction: vi.fn(),
      evaluate: vi.fn()
        .mockResolvedValueOnce(handlers)
        .mockResolvedValueOnce([{ id: 't1', status: 'fail', error: 'a' }])
        .mockResolvedValueOnce([{ id: 't2', status: 'fail', error: 'b' }]),
    };
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig,
      maxFailures: 2,
      chunkSize: 1,
      contracts: [{ source: './openapi.json' }],
    });
    vi.mocked(loadContracts).mockResolvedValue([]);

    const result = await runTests();

    expect(result).toBe(true);
    expect(validateMocks).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run tests/runTests.test.js -t "stops early|maxFailures is 0|stops early"`
Expected: FAIL — no bail logic yet (loop runs all chunks; contracts still validated).

- [ ] **Step 3: Add the bail check to the loop**

In `src/index.js`, add a `stoppedEarly` flag and the threshold check inside the chunk loop (from Task 5). The loop becomes:

```js
    const handlers = registeredHandlers;
    const testStatus = [];
    let executed = 0;
    let stoppedEarly = false;

    for (const ids of chunks) {
      const chunkStatus = await page.evaluate(async (retryCount, chunkIds) => {
        // ... unchanged evaluate body from Task 5 ...
      }, config.retryCount, ids);

      testStatus.push(...chunkStatus);
      executed += ids.length;

      if (config.maxFailures > 0) {
        const failed = testStatus.filter((t) => t.status === 'fail').length;
        if (failed >= config.maxFailures) {
          stoppedEarly = true;
          break;
        }
      }
    }

    const durationMs = Date.now() - startedAt;
    const notRun = baseIds.length - executed;
    let hasFailures = stoppedEarly || testStatus.some((test) => test.status === 'fail');
```

Remove the old standalone `let hasFailures = testStatus.some(test => test.status === 'fail');` line so `hasFailures` is only declared once (now including `stoppedEarly`).

- [ ] **Step 4: Skip contract validation on an early stop**

In `src/index.js`, guard the contracts block so it does not run on an incomplete run. Change the condition:

```js
    // Contract validation (skipped on an early stop — the data is partial)
    if (!stoppedEarly && config.contracts && config.contracts.length > 0) {
      // ... existing contract validation body unchanged ...
    } else if (stoppedEarly && config.contracts && config.contracts.length > 0) {
      console.log('\nSkipping contract validation — run stopped early (partial data).');
    }
```

- [ ] **Step 5: Pass the new fields to the summary**

In `src/index.js`, update the final summary call:

```js
    console.log('');
    console.log(formatRunComplete({
      testStatus,
      handlers,
      durationMs,
      notRun,
      stoppedEarly,
      maxFailures: config.maxFailures,
    }));
```

- [ ] **Step 6: Run the run-flow tests to verify they pass**

Run: `npx vitest run tests/runTests.test.js`
Expected: PASS (new bail tests and all prior tests).

- [ ] **Step 7: Commit**

```bash
git add src/index.js tests/runTests.test.js
git commit -m "feat: stop the run early after maxFailures failures

Bail out of the chunk loop once total failures reach maxFailures,
report the Not-run count and banner, and skip contract validation on
the incomplete run.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Durable partial results on timeout/crash

If a chunk `evaluate` throws (e.g. `protocolTimeout` on a hung test), print the results gathered from completed chunks before the diagnostic, instead of losing everything.

**Files:**
- Modify: `src/index.js` (hoist run state above `try`; print partial results in `catch`)
- Test: `tests/runTests.test.js`

**Interfaces:** no signature change. On a mid-run throw, `runTests` still rejects (as today) but first prints a partial run-complete block and an "interrupted" note.

- [ ] **Step 1: Write the failing test**

Append to the `describe('runTests', ...)` block in `tests/runTests.test.js`:

```js
  it("prints partial results when a chunk times out mid-run", async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handlers = [
      { id: 's1', name: 'Suite', type: 'suite' },
      { id: 't1', name: 't1', parent: 's1', type: 'test' },
      { id: 't2', name: 't2', parent: 's1', type: 'test' },
      { id: 't3', name: 't3', parent: 's1', type: 'test' },
    ];
    const timeoutError = new Error('Runtime.callFunctionOn timed out.');
    timeoutError.name = 'ProtocolError';
    const page = {
      goto: vi.fn(),
      waitForSelector: vi.fn(),
      exposeFunction: vi.fn(),
      evaluate: vi.fn()
        .mockResolvedValueOnce(handlers)                             // enumeration
        .mockResolvedValueOnce([{ id: 't1', status: 'pass' }])       // chunk 1 ok
        .mockRejectedValueOnce(timeoutError),                        // chunk 2 hangs
    };
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig,
      chunkSize: 1,
    });

    await expect(runTests()).rejects.toThrow('timed out');

    const logs = consoleSpy.mock.calls.map((c) => String(c[0]));
    const block = logs.find((l) => l.startsWith('--- Run complete ---'));
    expect(block).toBeDefined();
    expect(block).toContain('Passed: 1');
    const errors = errorSpy.mock.calls.map((c) => String(c[0]));
    expect(errors.some((e) => e.includes('protocolTimeout'))).toBe(true);
    expect(browser.close).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/runTests.test.js -t "prints partial results when a chunk times out"`
Expected: FAIL — no run-complete block is printed on the crash path (results are lost).

- [ ] **Step 3: Hoist run state so `catch` can see partial results**

In `src/index.js`, declare the accumulators alongside the existing `let browser; let config;` at the top of `runTests` (before the `try`):

```js
  let browser;
  let config;
  let startedAt = null;
  let partialStatus = [];
  let partialHandlers = [];
```

Inside the `try`, set `startedAt` where it is created today (`startedAt = Date.now();` instead of `const startedAt = ...`). After the enumeration, assign `partialHandlers = registeredHandlers;`. In the chunk loop, change the local accumulator to write through to the hoisted one: use `partialStatus` as the accumulation array (replace `const testStatus = [];` inside the try with `partialStatus = [];` and use `partialStatus` where the loop currently pushes and reads). Where the summary is built, use `const testStatus = partialStatus;` so the rest of the success path is unchanged.

Concretely, the success-path lines become:

```js
    startedAt = Date.now();
    // ... goto / waitForSelector / enumeration ...
    partialHandlers = registeredHandlers;
    // ... filter resolution ...

    const baseIds = selectedIds ?? orderedTestIds(registeredHandlers);
    const chunks = chunk(baseIds, config.chunkSize);

    const handlers = registeredHandlers;
    partialStatus = [];
    let executed = 0;
    let stoppedEarly = false;

    for (const ids of chunks) {
      const chunkStatus = await page.evaluate(/* ... */, config.retryCount, ids);
      partialStatus.push(...chunkStatus);
      executed += ids.length;
      if (config.maxFailures > 0) {
        const failed = partialStatus.filter((t) => t.status === 'fail').length;
        if (failed >= config.maxFailures) { stoppedEarly = true; break; }
      }
    }

    const testStatus = partialStatus;
    const durationMs = Date.now() - startedAt;
    const notRun = baseIds.length - executed;
```

Everything below (`hasFailures`, contracts, coverage, summary) stays as written in Task 6.

- [ ] **Step 4: Print partial results in `catch`**

In `src/index.js`, at the top of the `catch (error) {` block (before the existing `console.error(...)` diagnostic lines), add:

```js
    if (partialStatus.length > 0) {
      const durationMs = startedAt ? Date.now() - startedAt : 0;
      console.log('');
      console.log(formatRunComplete({
        testStatus: partialStatus,
        handlers: partialHandlers,
        durationMs,
      }));
      console.log('\nRun interrupted before completion — results above are partial.');
    }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/runTests.test.js -t "prints partial results when a chunk times out"`
Expected: PASS.

- [ ] **Step 6: Run the whole suite**

Run: `npm run test:ci`
Expected: PASS (all files). In particular the existing "protocolTimeout hint when the run aborts" test still passes — its `page.evaluate` rejects on the first (enumeration) call, so `partialStatus` is empty and only the diagnostic prints.

- [ ] **Step 7: Commit**

```bash
git add src/index.js tests/runTests.test.js
git commit -m "feat: print partial results when a run is interrupted

Accumulate results in Node-visible state so a mid-run protocolTimeout
or crash surfaces the tests that completed instead of discarding the
whole run.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Document the new config keys

**Files:**
- Modify: `README.md` (config section)
- Modify: `CLAUDE.md` (the `src/config.js` description under Architecture)
- Modify: `docs/superpowers/specs/2026-07-21-max-failures-early-bail-design.md` (status line)

**Interfaces:** none (docs only).

- [ ] **Step 1: Document in README**

Find the config/`twd.config.json` documentation section in `README.md` and add entries for the two keys (match the surrounding table/list style). Content to convey:
- `maxFailures` (default `10`): stop the run once this many tests have failed in total; the CLI prints the results gathered so far and exits non-zero. Set `0` to disable and always run every test.
- `chunkSize` (default `10`): how many tests run per browser call. Smaller values make the failure limit and timeouts more granular (less work lost if one chunk hangs); larger values reduce overhead. `0` runs everything in one call.

Also add one line noting that on a `protocolTimeout` or crash mid-run, results from completed chunks are now printed instead of lost.

- [ ] **Step 2: Update CLAUDE.md architecture note**

In `CLAUDE.md`, update the `src/config.js` bullet to list `maxFailures` and `chunkSize` among the merged defaults, and update the `src/index.js` description: the suite no longer runs in a single `page.evaluate` — it runs in ordered chunks via `runByIds`, accumulating results in Node so the run can stop after `maxFailures` and partial results survive a timeout.

- [ ] **Step 3: Flip the spec status to Implemented**

In `docs/superpowers/specs/2026-07-21-max-failures-early-bail-design.md`, change `**Status:** Approved (pending spec review)` to `**Status:** Implemented`.

- [ ] **Step 4: Verify the docs mention the keys**

Run: `grep -n "maxFailures" README.md CLAUDE.md && grep -n "chunkSize" README.md CLAUDE.md`
Expected: at least one match in each file.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md docs/superpowers/specs/2026-07-21-max-failures-early-bail-design.md
git commit -m "docs: document maxFailures and chunkSize config

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Chunked Node-driven execution → Task 5.
- `maxFailures` bail (total failures) → Task 6.
- `chunkSize` → Tasks 1, 2, 5.
- Durable partial results on timeout/crash → Task 7.
- `Not run` + early-stop banner → Task 3 (consumed in Task 6/7).
- Skip contracts on early stop → Task 6.
- `protocolTimeout` diagnostic reword → Task 4.
- Coverage unchanged (already skipped on failures) → no task needed; verified by existing suite in Task 5/6.
- Config defaults + docs → Tasks 1, 8.

**Placeholder scan:** No TBD/TODO; every code step shows full code.

**Type/name consistency:** `orderedTestIds`/`chunk` (Task 2) are consumed with those names in Task 5. `formatRunComplete` params `notRun`/`stoppedEarly`/`maxFailures` (Task 3) are passed with those names in Task 6/7. The chunk `evaluate` returns a testStatus array in Tasks 5–7 and the mock harness (Task 5 Step 1) matches. `stoppedEarly`/`notRun`/`executed`/`partialStatus`/`partialHandlers` are introduced and used consistently within `src/index.js`.

**Note for the implementer:** Tasks 5–7 all edit the same run section of `src/index.js` in sequence; apply them in order. Task 5 leaves a plain chunk loop, Task 6 adds the bail + summary fields, Task 7 hoists the accumulators for the crash path. Re-read the current `src/index.js` before each of these tasks.
