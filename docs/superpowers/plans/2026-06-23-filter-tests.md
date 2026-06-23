# `--test` Filter Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repeatable `--test "<value>"` CLI flag that runs only the TWD tests whose full `"Suite > test"` path contains a filter value (case-insensitive), for fast targeted debugging.

**Architecture:** Two new pure, unit-tested helpers (`parseRunArgs` for the CLI, `selectTestIds` for matching) feed into `runTests()`. When filters are present, `runTests` reads the in-browser test registry (`window.__TWD_STATE__.handlers`), matches in Node, and runs the matched ids via the existing `window.__testRunner.runByIds(ids)` instead of `runAll()`. No new dependencies.

**Tech Stack:** Node.js ESM, Puppeteer, twd-js, Vitest.

## Global Constraints

- ESM only (`import`/`export`), Node >= 18.
- No new dependencies — `package.json` `dependencies` stay `openapi-mock-validator`, `puppeteer`, `twd-js`. (No `npm run lock:linux` needed.)
- All work on branch `feat/filter-tests`. No commits on `main`.
- Matching is **case-insensitive substring** against the **full path** `"Suite > Subsuite > test name"`.
- Multiple `--test` flags are **OR**. Zero total matches → CLI exits 1.
- Reuse the existing `src/buildTestPath.js` helper for path construction.

---

### Task 1: `selectTestIds` matcher

**Files:**
- Create: `src/filterTests.js`
- Test: `tests/filterTests.test.js`

**Interfaces:**
- Consumes: `buildTestPath(testId, handlers)` from `src/buildTestPath.js` — returns `"Suite > test"` or `null`.
- Produces: `selectTestIds(handlers, filters)` where `handlers` is `Array<{ id, name, parent, type }>` and `filters` is `string[]`. Returns `{ ids: string[], unmatchedFilters: string[] }`. `ids` are the ids of `type === 'test'` handlers whose lowercased full path contains any lowercased filter as a substring. `unmatchedFilters` are filter values (original casing) that matched no test.

- [ ] **Step 1: Write the failing test**

```js
// tests/filterTests.test.js
import { describe, it, expect } from "vitest";
import { selectTestIds } from "../src/filterTests.js";

const handlers = [
  { id: 's1', name: 'Login', parent: undefined, type: 'suite' },
  { id: 't1', name: 'shows error on bad password', parent: 's1', type: 'test' },
  { id: 't2', name: 'redirects on success', parent: 's1', type: 'test' },
  { id: 's2', name: 'Signup', parent: undefined, type: 'suite' },
  { id: 't3', name: 'shows error on taken email', parent: 's2', type: 'test' },
];

describe("selectTestIds", () => {
  it("matches a leaf test name by case-insensitive substring", () => {
    const { ids, unmatchedFilters } = selectTestIds(handlers, ['REDIRECTS']);
    expect(ids).toEqual(['t2']);
    expect(unmatchedFilters).toEqual([]);
  });

  it("matches all tests under a describe via the full path", () => {
    const { ids } = selectTestIds(handlers, ['Login']);
    expect(ids.sort()).toEqual(['t1', 't2']);
  });

  it("treats multiple filters as OR", () => {
    const { ids } = selectTestIds(handlers, ['redirects', 'taken email']);
    expect(ids.sort()).toEqual(['t2', 't3']);
  });

  it("matches the same substring across suites", () => {
    const { ids } = selectTestIds(handlers, ['shows error']);
    expect(ids.sort()).toEqual(['t1', 't3']);
  });

  it("reports filters that matched nothing", () => {
    const { ids, unmatchedFilters } = selectTestIds(handlers, ['Login', 'nope']);
    expect(ids.sort()).toEqual(['t1', 't2']);
    expect(unmatchedFilters).toEqual(['nope']);
  });

  it("returns empty ids when nothing matches", () => {
    const { ids, unmatchedFilters } = selectTestIds(handlers, ['zzz']);
    expect(ids).toEqual([]);
    expect(unmatchedFilters).toEqual(['zzz']);
  });

  it("ignores suite handlers as run targets", () => {
    const { ids } = selectTestIds(handlers, ['Signup']);
    expect(ids).toEqual(['t3']); // s2 (the suite) is never an id
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/filterTests.test.js`
Expected: FAIL — `Failed to resolve import "../src/filterTests.js"` / `selectTestIds is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/filterTests.js
import { buildTestPath } from './buildTestPath.js';

export function selectTestIds(handlers, filters) {
  const needles = filters.map((f) => f.toLowerCase());
  const matchedNeedles = new Set();
  const ids = [];

  for (const handler of handlers) {
    if (handler.type !== 'test') continue;
    const path = buildTestPath(handler.id, handlers);
    if (!path) continue;
    const haystack = path.toLowerCase();

    let matched = false;
    for (let i = 0; i < needles.length; i++) {
      if (haystack.includes(needles[i])) {
        matched = true;
        matchedNeedles.add(i);
      }
    }
    if (matched) ids.push(handler.id);
  }

  const unmatchedFilters = filters.filter((_, i) => !matchedNeedles.has(i));
  return { ids, unmatchedFilters };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/filterTests.test.js`
Expected: PASS (7 passed).

- [ ] **Step 5: Commit**

```bash
git add src/filterTests.js tests/filterTests.test.js
git commit -m "feat: add selectTestIds matcher for test filtering"
```

---

### Task 2: `parseRunArgs` CLI argument parser

**Files:**
- Create: `src/parseArgs.js`
- Test: `tests/parseArgs.test.js`

**Interfaces:**
- Produces: `parseRunArgs(argv)` where `argv` is the array of tokens **after** the `run` command (i.e. `process.argv.slice(3)`). Returns `{ testFilters: string[] }`. Supports both `--test <value>` (value is the next token) and `--test=<value>` forms. Unknown tokens are ignored.

- [ ] **Step 1: Write the failing test**

```js
// tests/parseArgs.test.js
import { describe, it, expect } from "vitest";
import { parseRunArgs } from "../src/parseArgs.js";

describe("parseRunArgs", () => {
  it("returns empty filters when no args", () => {
    expect(parseRunArgs([])).toEqual({ testFilters: [] });
  });

  it("parses a single --test <value>", () => {
    expect(parseRunArgs(['--test', 'shows error'])).toEqual({
      testFilters: ['shows error'],
    });
  });

  it("parses repeated --test flags in order", () => {
    expect(parseRunArgs(['--test', 'Login', '--test', 'Signup'])).toEqual({
      testFilters: ['Login', 'Signup'],
    });
  });

  it("parses the --test=<value> form", () => {
    expect(parseRunArgs(['--test=Login'])).toEqual({
      testFilters: ['Login'],
    });
  });

  it("ignores a trailing --test with no value", () => {
    expect(parseRunArgs(['--test'])).toEqual({ testFilters: [] });
  });

  it("ignores unknown tokens", () => {
    expect(parseRunArgs(['--verbose', '--test', 'Login'])).toEqual({
      testFilters: ['Login'],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/parseArgs.test.js`
Expected: FAIL — `Failed to resolve import "../src/parseArgs.js"`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/parseArgs.js
export function parseRunArgs(argv) {
  const testFilters = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--test') {
      const value = argv[i + 1];
      if (value !== undefined) {
        testFilters.push(value);
        i++;
      }
    } else if (token.startsWith('--test=')) {
      testFilters.push(token.slice('--test='.length));
    }
  }

  return { testFilters };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/parseArgs.test.js`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
git add src/parseArgs.js tests/parseArgs.test.js
git commit -m "feat: add parseRunArgs CLI argument parser"
```

---

### Task 3: Wire filtering into `runTests`

**Files:**
- Modify: `src/index.js`
- Test: `tests/runTests.test.js`

**Interfaces:**
- Consumes: `selectTestIds(handlers, filters)` from `src/filterTests.js` (Task 1).
- Produces: `runTests(options = {})` now accepts `options.testFilters: string[]` (default `[]`). When non-empty it enumerates the in-browser registry, computes selected ids in Node, and the run `page.evaluate` is called as `evaluate(fn, retryCount, selectedIds)` where `selectedIds` is `string[]` (filtered) or `null` (full run). Zero matches → returns `true` and the run `evaluate` is **not** called. Coverage collection is skipped whenever `selectedIds` is non-null.

- [ ] **Step 1: Write the failing tests**

Add these tests inside the existing `describe("runTests", …)` block in `tests/runTests.test.js` (the file's mocks and helpers from Task context are already in place):

```js
  it("passes selectedIds=null to the run evaluate when no filter", async () => {
    const testStatus = [{ id: '1', status: 'pass' }];
    const handlers = [{ id: '1', name: 'test1', type: 'test' }];
    const page = createMockPage({ handlers, testStatus });
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runTests();

    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 2, null);
  });

  it("runs only matching tests when a --test filter is given", async () => {
    const registry = [
      { id: 's1', name: 'Login', parent: undefined, type: 'suite' },
      { id: 't1', name: 'shows error', parent: 's1', type: 'test' },
      { id: 't2', name: 'redirects', parent: 's1', type: 'test' },
    ];
    const runResult = {
      handlers: registry,
      testStatus: [{ id: 't1', status: 'pass' }],
    };
    const page = {
      goto: vi.fn(),
      waitForSelector: vi.fn(),
      exposeFunction: vi.fn(),
      evaluate: vi.fn()
        .mockResolvedValueOnce(registry)   // enumeration pass
        .mockResolvedValueOnce(runResult), // run pass
    };
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    const result = await runTests({ testFilters: ['shows error'] });

    expect(result).toBe(false);
    // second evaluate call is the run; selectedIds is the matched ids
    expect(page.evaluate).toHaveBeenNthCalledWith(2, expect.any(Function), 2, ['t1']);
  });

  it("returns true and skips the run when a filter matches nothing", async () => {
    const registry = [
      { id: 't1', name: 'shows error', parent: undefined, type: 'test' },
    ];
    const page = {
      goto: vi.fn(),
      waitForSelector: vi.fn(),
      exposeFunction: vi.fn(),
      evaluate: vi.fn().mockResolvedValueOnce(registry),
    };
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await runTests({ testFilters: ['nope'] });

    expect(result).toBe(true);
    expect(page.evaluate).toHaveBeenCalledTimes(1); // enumeration only, no run
    expect(browser.close).toHaveBeenCalled();
    const errors = errorSpy.mock.calls.map((c) => String(c[0]));
    expect(errors.some((e) => e.includes('No tests matched') && e.includes('nope'))).toBe(true);
    errorSpy.mockRestore();
  });

  it("skips coverage collection when a filter is active", async () => {
    const registry = [
      { id: 't1', name: 'shows error', parent: undefined, type: 'test' },
    ];
    const runResult = { handlers: registry, testStatus: [{ id: 't1', status: 'pass' }] };
    const page = {
      goto: vi.fn(),
      waitForSelector: vi.fn(),
      exposeFunction: vi.fn(),
      evaluate: vi.fn()
        .mockResolvedValueOnce(registry)
        .mockResolvedValueOnce(runResult),
    };
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, coverage: true });

    await runTests({ testFilters: ['shows error'] });

    // only the 2 evaluate calls happened (enumeration + run); coverage would be a 3rd
    expect(page.evaluate).toHaveBeenCalledTimes(2);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });
```

Also update the existing assertion in `should pass retryCount to page.evaluate`:

```js
    // page.evaluate is called with (fn, retryCount, selectedIds)
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 3, null);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/runTests.test.js`
Expected: FAIL — new filter tests fail (no enumeration pass, `selectedIds` arg missing); the updated retryCount assertion fails because the current code calls `evaluate(fn, 3)` without the third arg.

- [ ] **Step 3: Add the imports and `testFilters` parameter**

In `src/index.js`, add the import near the other `./` imports (after line 10):

```js
import { selectTestIds } from './filterTests.js';
```

Change the function signature (line 20) from:

```js
export async function runTests() {
```

to:

```js
export async function runTests(options = {}) {
  const { testFilters = [] } = options;
```

- [ ] **Step 4: Add the enumeration + matching block before the run `page.evaluate`**

In `src/index.js`, immediately after the `console.log('Page loaded. Starting tests...');` line (currently line 64) and before the `const { handlers, testStatus } = await page.evaluate(` block, insert:

```js
    // Resolve --test filters to a concrete set of test ids (null = run all)
    let selectedIds = null;
    if (testFilters.length > 0) {
      const registeredHandlers = await page.evaluate(() => {
        const state = window.__TWD_STATE__;
        if (!state || !state.handlers) return [];
        return Array.from(state.handlers.values()).map((h) => ({
          id: h.id,
          name: h.name,
          parent: h.parent,
          type: h.type,
        }));
      });

      const { ids, unmatchedFilters } = selectTestIds(registeredHandlers, testFilters);

      if (ids.length === 0) {
        console.error(
          `No tests matched filter(s): ${testFilters.map((f) => `"${f}"`).join(', ')}`
        );
        await browser.close();
        return true;
      }

      if (unmatchedFilters.length > 0) {
        console.warn(
          `Warning: no tests matched: ${unmatchedFilters.map((f) => `"${f}"`).join(', ')}`
        );
      }

      selectedIds = ids;
      console.log(`Filtering: running ${ids.length} test(s) matching --test filter(s).`);
    }
```

- [ ] **Step 5: Make the run `page.evaluate` honor `selectedIds`**

In `src/index.js`, change the run evaluate's function signature from:

```js
    const { handlers, testStatus } = await page.evaluate(async (retryCount) => {
```

to:

```js
    const { handlers, testStatus } = await page.evaluate(async (retryCount, selectedIds) => {
```

Change the run call from:

```js
      const handlers = await runner.runAll();
```

to:

```js
      const handlers = selectedIds
        ? await runner.runByIds(selectedIds)
        : await runner.runAll();
```

And change the trailing args of that `page.evaluate(...)` call from:

```js
    }, config.retryCount);
```

to:

```js
    }, config.retryCount, selectedIds);
```

- [ ] **Step 6: Skip coverage when filtering**

In `src/index.js`, find the coverage block:

```js
    // Handle code coverage if enabled
    if (config.coverage && !hasFailures) {
```

Replace those two lines with this (adds a skip-log for filtered runs, then adds `&& !selectedIds` to the guard):

```js
    // Handle code coverage if enabled (skipped when a --test filter is active)
    if (selectedIds && config.coverage) {
      console.log('Skipping coverage collection (test filter active).');
    }
    if (config.coverage && !hasFailures && !selectedIds) {
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/runTests.test.js`
Expected: PASS (all existing + 4 new filter tests).

- [ ] **Step 8: Run the full suite**

Run: `npm run test:ci`
Expected: PASS — all test files green.

- [ ] **Step 9: Commit**

```bash
git add src/index.js tests/runTests.test.js
git commit -m "feat: filter tests via --test in runTests"
```

---

### Task 4: Wire the `--test` flag into the CLI entry point

**Files:**
- Modify: `bin/twd-cli.js`

**Interfaces:**
- Consumes: `parseRunArgs(argv)` from `src/parseArgs.js` (Task 2) and `runTests(options)` from `src/index.js` (Task 3).

- [ ] **Step 1: Update `bin/twd-cli.js`**

Replace the entire contents of `bin/twd-cli.js` with:

```js
#!/usr/bin/env node

import { runTests } from '../src/index.js';
import { parseRunArgs } from '../src/parseArgs.js';

const command = process.argv[2];

if (command === 'run') {
  try {
    const { testFilters } = parseRunArgs(process.argv.slice(3));
    const hasFailures = await runTests({ testFilters });
    process.exit(hasFailures ? 1 : 0);
  } catch (error) {
    process.exit(1);
  }
} else {
  console.log(`
twd-cli - Test runner for TWD tests

Usage:
  npx twd-cli run                  Run all tests
  npx twd-cli run --test "<name>"  Run only tests whose "suite > test" path
                                   contains <name> (case-insensitive).
                                   Repeatable; multiple --test values are OR'd.

Examples:
  npx twd-cli run --test "shows error"
  npx twd-cli run --test "Login" --test "Signup"

Options:
  Create a twd.config.json file in your project root to customize settings.
  `);
  process.exit(command ? 1 : 0);
}
```

- [ ] **Step 2: Verify the help text manually**

Run: `node ./bin/twd-cli.js`
Expected: help text prints and includes the `--test "<name>"` usage and the two examples; process exits 0 (no command given).

- [ ] **Step 3: Verify arg parsing reaches runTests (no dev server needed)**

Run: `node ./bin/twd-cli.js run --test "definitely-not-a-real-test-xyz"`
Expected: the runner starts, fails to connect to the dev server (Puppeteer navigation/selector error), and the process exits 1. This confirms the `run` path executes with filters wired in. (A full green-path check happens in Task 5's manual run / existing CI usage.)

- [ ] **Step 4: Commit**

```bash
git add bin/twd-cli.js
git commit -m "feat: parse --test flag in CLI entry point"
```

---

### Task 5: Document `--test` in the README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a "Filtering tests" subsection**

In `README.md`, directly after the `### Basic Usage` section (before `### Configuration`), insert:

```markdown
### Filtering tests

Run only a subset of tests with the repeatable `--test` flag. Matching is
**case-insensitive** and matches a **substring** of each test's full
`"Suite > test name"` path:

```bash
# Run every test whose name contains "shows error"
npx twd-cli run --test "shows error"

# Because matching uses the full "suite > test" path, passing a describe
# name runs every test inside that describe block:
npx twd-cli run --test "Login"

# Multiple --test flags are combined with OR (a test runs if it matches any):
npx twd-cli run --test "Login" --test "Signup"
```

Notes:

- If no test matches any filter, the run exits with code `1` and prints
  `No tests matched filter(s): …` — so a typo won't silently look like a pass.
- Code coverage collection is skipped while a `--test` filter is active, since a
  filtered run is a partial (debug) run.
```

- [ ] **Step 2: Verify the README renders**

Run: `grep -n "Filtering tests" README.md`
Expected: prints the new heading line.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document --test filter flag"
```

---

## Self-Review Notes

- **Spec coverage:** repeatable `--test` (Task 2, 4) ✓; case-insensitive substring on full path incl. describe (Task 1) ✓; OR semantics (Task 1) ✓; zero-match exits 1 (Task 3) ✓; `runByIds` selective run (Task 3) ✓; coverage skipped under filter (Task 3) ✓; `buildTestPath` reuse (Task 1) ✓; README "Filtering tests" (Task 5) ✓; no deps / branch discipline (Global Constraints) ✓.
- **Type consistency:** `selectTestIds(handlers, filters) -> { ids, unmatchedFilters }` used identically in Task 1 and Task 3; `parseRunArgs(argv) -> { testFilters }` used identically in Task 2 and Task 4; `runTests({ testFilters })` consistent across Tasks 3–4; the run `page.evaluate(fn, retryCount, selectedIds)` shape is consistent across the Task 3 steps and tests.
- **Placeholders:** none — every code/test step is complete.
