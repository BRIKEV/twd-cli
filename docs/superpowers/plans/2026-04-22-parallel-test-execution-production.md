# Parallel Test Execution (Production) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an opt-in `parallel: true` mode in `twd-cli` that runs the TWD suite across two isolated Puppeteer browser contexts, reusing existing retries, coverage, and contract validation — with zero regression risk for `parallel: false` (default).

**Architecture:** A new `src/runParallel.js` module (~200 LoC) implements the parallel path. A new `src/mergeMocks.js` utility combines per-worker mock maps. `src/index.js` grows a thin branch: if `config.parallel` is truthy, delegate to `runParallel`; otherwise run the existing serial body, unchanged. Each worker self-filters tests by `idx % N === workerIndex` inside its own `page.evaluate` (random twd-js test IDs are not stable across contexts). Anti-throttle flags are automatically appended to `config.puppeteerArgs` unless already present.

**Tech Stack:** Node.js (ESM), Puppeteer 24.x (`browser.createBrowserContext()`), existing `twd-js` in-browser `TestRunner` (with its built-in retry loop), Vitest with `vi.mock('puppeteer')` for unit testing.

---

## ⚠ Commit Policy for This Plan

Per project convention, **the executor MUST NOT run `git commit` without explicit user approval in the current turn.** Every "commit" step is written as *stage + propose*: run `git add` the specific files, print the proposed commit message, then stop for the user to say "commit". Never bundle `git add` and `git commit` together autonomously.

The feature branch `feat/parallel-execution` is already checked out. The POC spec/plan/code from yesterday's work remain on this branch (staged but not committed for `poc/parallel/run-parallel.js` + `README.md`; untracked for the spec and plan docs). This production work layers on top of that state.

---

## File Structure

**Files to create:**
- `src/runParallel.js` — the parallel orchestration module (~200 LoC)
- `src/mergeMocks.js` — pure utility that merges per-worker mock maps (~30 LoC)
- `tests/runParallel.test.js` — unit tests mirroring `tests/runTests.test.js`
- `tests/mergeMocks.test.js` — pure-function unit tests

**Files to modify:**
- `src/config.js` — add `parallel: false` to `DEFAULT_CONFIG`
- `tests/config.test.js` — include `parallel: false` in the default-config assertions
- `src/index.js` — add a thin branch on `config.parallel` at the top of `runTests()`
- `tests/runTests.test.js` — one new test asserting serial path is NOT triggered when `parallel: true`
- `README.md` — document the new `parallel` config field (one paragraph)

No package.json changes. No new dependencies.

---

## Task 1: Add `parallel` to config defaults

**Files:**
- Modify: `/Users/kevinccbsg/brikev/twd-cli/src/config.js`
- Modify: `/Users/kevinccbsg/brikev/twd-cli/tests/config.test.js`

### Step 1: Update config default-config test to expect `parallel: false`

Edit `/Users/kevinccbsg/brikev/twd-cli/tests/config.test.js`. In the three places that assert the full default config object (the tests titled `"should load default config when no config file exists"`, `"should merge user config with defaults when config file exists"`, and `"should return defaults and warn when config file has invalid JSON"`), add `parallel: false,` to each `expect(config).toEqual({...})` block.

For example, the first test's expected object becomes:
```javascript
expect(config).toEqual({
  url: 'http://localhost:5173',
  timeout: 10000,
  coverage: true,
  coverageDir: './coverage',
  nycOutputDir: './.nyc_output',
  headless: true,
  puppeteerArgs: ['--no-sandbox', '--disable-setuid-sandbox'],
  retryCount: 2,
  parallel: false,
});
```

Apply the same `parallel: false,` addition to the object in the `"should merge user config with defaults"` test and the `"should return defaults and warn"` test.

### Step 2: Run the config tests — expect the three to fail

```bash
cd /Users/kevinccbsg/brikev/twd-cli
npx vitest run tests/config.test.js
```

Expected: 3 failing tests — the three that assert the full default-config object. Error message will show the actual object missing `parallel: false`.

### Step 3: Add `parallel: false` to `DEFAULT_CONFIG` in `src/config.js`

Edit `/Users/kevinccbsg/brikev/twd-cli/src/config.js`. Change:

```javascript
const DEFAULT_CONFIG = {
  url: 'http://localhost:5173',
  timeout: 10000,
  coverage: true,
  coverageDir: './coverage',
  nycOutputDir: './.nyc_output',
  headless: true,
  puppeteerArgs: ['--no-sandbox', '--disable-setuid-sandbox'],
  retryCount: 2,
};
```

to:

```javascript
const DEFAULT_CONFIG = {
  url: 'http://localhost:5173',
  timeout: 10000,
  coverage: true,
  coverageDir: './coverage',
  nycOutputDir: './.nyc_output',
  headless: true,
  puppeteerArgs: ['--no-sandbox', '--disable-setuid-sandbox'],
  retryCount: 2,
  parallel: false,
};
```

### Step 4: Run config tests — expect all to pass

```bash
cd /Users/kevinccbsg/brikev/twd-cli
npx vitest run tests/config.test.js
```

Expected: all config tests pass.

### Step 5: Stage and propose commit (DO NOT COMMIT)

```bash
cd /Users/kevinccbsg/brikev/twd-cli
git add src/config.js tests/config.test.js
```

Proposed commit message:
```
feat(config): add parallel flag to DEFAULT_CONFIG (default false)

Adds a `parallel` boolean field to the config schema with a default of
false. No behavior change — subsequent commits wire the flag into a new
runParallel module.
```

Wait for user approval before running `git commit`.

---

## Task 2: `mergeMocks` utility (TDD, pure function)

**Files:**
- Create: `/Users/kevinccbsg/brikev/twd-cli/tests/mergeMocks.test.js`
- Create: `/Users/kevinccbsg/brikev/twd-cli/src/mergeMocks.js`

The merge utility takes an array of per-worker `Map<dedupKey, mock>` and produces one `Map` with worker-index-prefixed keys, guaranteeing no silent collision if two workers' random test IDs ever overlap.

### Step 1: Write `tests/mergeMocks.test.js` with four cases

Create `/Users/kevinccbsg/brikev/twd-cli/tests/mergeMocks.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { mergeMocks } from '../src/mergeMocks.js';

describe('mergeMocks', () => {
  it('returns an empty map when given an array of empty maps', () => {
    const merged = mergeMocks([new Map(), new Map()]);
    expect(merged.size).toBe(0);
  });

  it('prefixes entries from a single worker with w0:', () => {
    const w0 = new Map([
      ['GET:/api/a:200:t1:1', { alias: 'a', testId: 't1' }],
    ]);
    const merged = mergeMocks([w0, new Map()]);
    expect(merged.size).toBe(1);
    expect(merged.has('w0:GET:/api/a:200:t1:1')).toBe(true);
  });

  it('preserves entries from both workers with disjoint keys', () => {
    const w0 = new Map([['GET:/a:200:t1:1', { alias: 'a', testId: 't1' }]]);
    const w1 = new Map([['GET:/b:200:t2:1', { alias: 'b', testId: 't2' }]]);
    const merged = mergeMocks([w0, w1]);
    expect(merged.size).toBe(2);
    expect(merged.has('w0:GET:/a:200:t1:1')).toBe(true);
    expect(merged.has('w1:GET:/b:200:t2:1')).toBe(true);
  });

  it('keeps both entries when two workers happen to use the same inner key', () => {
    // Defense-in-depth: twd-js random IDs could collide; the prefix must
    // prevent one worker from overwriting the other's mock.
    const sharedInnerKey = 'GET:/api/users:200:same-id:1';
    const w0 = new Map([[sharedInnerKey, { alias: 'users', testId: 'same-id', from: 0 }]]);
    const w1 = new Map([[sharedInnerKey, { alias: 'users', testId: 'same-id', from: 1 }]]);
    const merged = mergeMocks([w0, w1]);
    expect(merged.size).toBe(2);
    expect(merged.get(`w0:${sharedInnerKey}`).from).toBe(0);
    expect(merged.get(`w1:${sharedInnerKey}`).from).toBe(1);
  });

  it('attaches workerIndex to each merged mock', () => {
    const w0 = new Map([['k', { alias: 'a' }]]);
    const w1 = new Map([['k', { alias: 'a' }]]);
    const merged = mergeMocks([w0, w1]);
    expect(merged.get('w0:k').workerIndex).toBe(0);
    expect(merged.get('w1:k').workerIndex).toBe(1);
  });
});
```

### Step 2: Run the test — expect failure (module not found)

```bash
cd /Users/kevinccbsg/brikev/twd-cli
npx vitest run tests/mergeMocks.test.js
```

Expected: test suite fails with `Failed to resolve import "../src/mergeMocks.js"`.

### Step 3: Implement `src/mergeMocks.js`

Create `/Users/kevinccbsg/brikev/twd-cli/src/mergeMocks.js`:

```javascript
// Merge per-worker mock maps into a single map.
// Key scheme: `w${workerIndex}:${originalKey}` — worker-index prefix is
// defense-in-depth against random-ID collisions across contexts.
// Each output mock gets a workerIndex field so downstream enrichment
// (buildTestPath) can pick the correct worker's handler tree.
export function mergeMocks(workerMaps) {
  const merged = new Map();
  workerMaps.forEach((workerMap, workerIndex) => {
    for (const [key, mock] of workerMap) {
      merged.set(`w${workerIndex}:${key}`, { ...mock, workerIndex });
    }
  });
  return merged;
}
```

### Step 4: Run the test — expect all 5 pass

```bash
cd /Users/kevinccbsg/brikev/twd-cli
npx vitest run tests/mergeMocks.test.js
```

Expected: all 5 `mergeMocks` tests pass.

### Step 5: Stage and propose commit (DO NOT COMMIT)

```bash
cd /Users/kevinccbsg/brikev/twd-cli
git add src/mergeMocks.js tests/mergeMocks.test.js
```

Proposed commit message:
```
feat(mergeMocks): add pure utility for per-worker mock merging

Worker-index-prefixed keys prevent silent collisions if two browser
contexts happen to generate the same twd-js random testId. Each
merged mock carries its workerIndex field for downstream testName
resolution.
```

Wait for user approval.

---

## Task 3: `runParallel` module — core execution (no contracts yet)

**Files:**
- Create: `/Users/kevinccbsg/brikev/twd-cli/tests/runParallel.test.js` (partial — no contract tests yet)
- Create: `/Users/kevinccbsg/brikev/twd-cli/src/runParallel.js` (no contract handling yet)

This is the main task. It covers: launching Puppeteer with anti-throttle flags, creating 2 browser contexts, running `runByIds` in each via `page.evaluate` with `workerIndex`/`N`/`retryCount`, dumping per-worker coverage files, aggregating pass/fail counts, and returning the correct `hasFailures` value. Contract handling and the `exposeFunction` call come in Task 4.

### Step 1: Write `tests/runParallel.test.js` with core tests

Create `/Users/kevinccbsg/brikev/twd-cli/tests/runParallel.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runParallel } from '../src/runParallel.js';

vi.mock('fs');
vi.mock('puppeteer');
vi.mock('twd-js/runner-ci', () => ({ reportResults: vi.fn() }));
vi.mock('../src/contracts.js', () => ({ validateMocks: vi.fn() }));
vi.mock('../src/contractReport.js', () => ({ printContractReport: vi.fn() }));
vi.mock('../src/contractMarkdown.js', () => ({ generateContractMarkdown: vi.fn() }));

import fs from 'fs';
import puppeteer from 'puppeteer';
import { reportResults } from 'twd-js/runner-ci';

function createMockPage(evaluateResult, coverage = null) {
  const page = {
    goto: vi.fn(),
    waitForSelector: vi.fn(),
    exposeFunction: vi.fn(),
    evaluate: vi.fn(),
  };
  // page.evaluate is called twice per worker: once for runByIds, once for __coverage__.
  page.evaluate
    .mockResolvedValueOnce(evaluateResult)     // runByIds call
    .mockResolvedValueOnce(coverage);          // __coverage__ call
  return page;
}

function createMockContext(page) {
  return {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn(),
  };
}

function createMockBrowser(contexts) {
  let i = 0;
  return {
    createBrowserContext: vi.fn().mockImplementation(() => contexts[i++]),
    close: vi.fn(),
  };
}

const baseConfig = {
  url: 'http://localhost:5173',
  timeout: 10000,
  coverage: false,
  coverageDir: './coverage',
  nycOutputDir: './.nyc_output',
  headless: true,
  puppeteerArgs: [],
  retryCount: 2,
  parallel: true,
};

describe('runParallel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'time').mockImplementation(() => {});
    vi.spyOn(console, 'timeEnd').mockImplementation(() => {});
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockImplementation(() => {});
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.rmSync).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('launches puppeteer once and creates 2 browser contexts', async () => {
    const page0 = createMockPage({ handlers: [], testStatus: [] });
    const page1 = createMockPage({ handlers: [], testStatus: [] });
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runParallel(baseConfig, '/cwd', []);

    expect(puppeteer.launch).toHaveBeenCalledTimes(1);
    expect(browser.createBrowserContext).toHaveBeenCalledTimes(2);
  });

  it('appends anti-throttle flags to user-supplied puppeteerArgs', async () => {
    const page0 = createMockPage({ handlers: [], testStatus: [] });
    const page1 = createMockPage({ handlers: [], testStatus: [] });
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runParallel({ ...baseConfig, puppeteerArgs: ['--user-flag'] }, '/cwd', []);

    const launchArgs = vi.mocked(puppeteer.launch).mock.calls[0][0].args;
    expect(launchArgs).toContain('--user-flag');
    expect(launchArgs).toContain('--disable-background-timer-throttling');
    expect(launchArgs).toContain('--disable-renderer-backgrounding');
    expect(launchArgs).toContain('--disable-backgrounding-occluded-windows');
  });

  it('does not duplicate an anti-throttle flag already provided by the user', async () => {
    const page0 = createMockPage({ handlers: [], testStatus: [] });
    const page1 = createMockPage({ handlers: [], testStatus: [] });
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runParallel(
      { ...baseConfig, puppeteerArgs: ['--disable-renderer-backgrounding'] },
      '/cwd',
      []
    );

    const launchArgs = vi.mocked(puppeteer.launch).mock.calls[0][0].args;
    const count = launchArgs.filter((a) => a === '--disable-renderer-backgrounding').length;
    expect(count).toBe(1);
  });

  it('navigates each page to config.url and waits for sidebar', async () => {
    const page0 = createMockPage({ handlers: [], testStatus: [] });
    const page1 = createMockPage({ handlers: [], testStatus: [] });
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runParallel(baseConfig, '/cwd', []);

    expect(page0.goto).toHaveBeenCalledWith('http://localhost:5173');
    expect(page1.goto).toHaveBeenCalledWith('http://localhost:5173');
    expect(page0.waitForSelector).toHaveBeenCalledWith(
      '#twd-sidebar-root',
      { timeout: 10000 }
    );
    expect(page1.waitForSelector).toHaveBeenCalledWith(
      '#twd-sidebar-root',
      { timeout: 10000 }
    );
  });

  it('passes workerIndex, N=2, and retryCount to each page.evaluate call', async () => {
    const page0 = createMockPage({ handlers: [], testStatus: [] });
    const page1 = createMockPage({ handlers: [], testStatus: [] });
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runParallel({ ...baseConfig, retryCount: 3 }, '/cwd', []);

    // First evaluate call per worker is the runByIds invocation.
    expect(page0.evaluate).toHaveBeenNthCalledWith(1, expect.any(Function), 0, 2, 3);
    expect(page1.evaluate).toHaveBeenNthCalledWith(1, expect.any(Function), 1, 2, 3);
  });

  it('sums pass/fail/skip counts across workers', async () => {
    const page0 = createMockPage({
      handlers: [{ id: 'a', name: 'a', type: 'test' }],
      testStatus: [{ id: 'a', status: 'pass' }],
    });
    const page1 = createMockPage({
      handlers: [{ id: 'b', name: 'b', type: 'test' }],
      testStatus: [{ id: 'b', status: 'fail', error: 'boom' }],
    });
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    const hasFailures = await runParallel(baseConfig, '/cwd', []);

    expect(hasFailures).toBe(true);
    expect(reportResults).toHaveBeenCalledTimes(2);
  });

  it('returns false when all workers pass', async () => {
    const page0 = createMockPage({
      handlers: [{ id: 'a', name: 'a', type: 'test' }],
      testStatus: [{ id: 'a', status: 'pass' }],
    });
    const page1 = createMockPage({
      handlers: [{ id: 'b', name: 'b', type: 'test' }],
      testStatus: [{ id: 'b', status: 'pass' }],
    });
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    const hasFailures = await runParallel(baseConfig, '/cwd', []);

    expect(hasFailures).toBe(false);
  });

  it('writes per-worker coverage files when config.coverage is true and __coverage__ is non-null', async () => {
    const page0 = createMockPage(
      { handlers: [], testStatus: [] },
      { file0: 'data' }
    );
    const page1 = createMockPage(
      { handlers: [], testStatus: [] },
      { file1: 'data' }
    );
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runParallel({ ...baseConfig, coverage: true }, '/cwd', []);

    const writes = vi.mocked(fs.writeFileSync).mock.calls.map((c) => c[0]);
    expect(writes.some((p) => p.endsWith('out-0.json'))).toBe(true);
    expect(writes.some((p) => p.endsWith('out-1.json'))).toBe(true);
  });

  it('does not write coverage files when config.coverage is false', async () => {
    const page0 = createMockPage({ handlers: [], testStatus: [] }, { file0: 'data' });
    const page1 = createMockPage({ handlers: [], testStatus: [] }, { file1: 'data' });
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runParallel({ ...baseConfig, coverage: false }, '/cwd', []);

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('dumps coverage even when a worker has failures', async () => {
    const page0 = createMockPage(
      {
        handlers: [{ id: 'a', name: 'a', type: 'test' }],
        testStatus: [{ id: 'a', status: 'fail', error: 'boom' }],
      },
      { file0: 'data' }
    );
    const page1 = createMockPage(
      { handlers: [], testStatus: [] },
      { file1: 'data' }
    );
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runParallel({ ...baseConfig, coverage: true }, '/cwd', []);

    expect(fs.writeFileSync).toHaveBeenCalledTimes(2);
  });

  it('cleans .nyc_output before running when coverage is enabled', async () => {
    const page0 = createMockPage({ handlers: [], testStatus: [] }, { a: 1 });
    const page1 = createMockPage({ handlers: [], testStatus: [] }, { a: 1 });
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    await runParallel({ ...baseConfig, coverage: true }, '/cwd', []);

    expect(fs.rmSync).toHaveBeenCalledWith(
      expect.stringContaining('.nyc_output'),
      { recursive: true, force: true }
    );
  });
});
```

### Step 2: Run the test — expect failure (module not found)

```bash
cd /Users/kevinccbsg/brikev/twd-cli
npx vitest run tests/runParallel.test.js
```

Expected: test suite fails with `Failed to resolve import "../src/runParallel.js"`.

### Step 3: Implement `src/runParallel.js` (core, no contracts)

Create `/Users/kevinccbsg/brikev/twd-cli/src/runParallel.js`:

```javascript
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import { reportResults } from 'twd-js/runner-ci';

const WORKERS = 2;

const ANTI_THROTTLE_FLAGS = [
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
];

function mergeArgs(userArgs, extras) {
  const merged = [...userArgs];
  for (const flag of extras) {
    if (!merged.includes(flag)) merged.push(flag);
  }
  return merged;
}

async function runWorker(browser, workerIndex, config, workingDir) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();

  await page.goto(config.url);
  await page.waitForSelector('#twd-sidebar-root', { timeout: config.timeout });

  const { handlers, testStatus } = await page.evaluate(
    async (workerIndex, N, retryCount) => {
      const allIds = Array.from(window.__TWD_STATE__.handlers.values())
        .filter((h) => h.type === 'test')
        .map((h) => h.id);
      const myIds = allIds.filter((_, idx) => idx % N === workerIndex);

      const TestRunner = window.__testRunner;
      const testStatus = [];
      const runner = new TestRunner(
        {
          onStart: (test) => { test.status = 'running'; },
          onPass: (test, retryAttempt) => {
            test.status = 'done';
            const entry = { id: test.id, status: 'pass' };
            if (retryAttempt !== undefined) entry.retryAttempt = retryAttempt;
            testStatus.push(entry);
          },
          onFail: (test, err) => {
            test.status = 'done';
            testStatus.push({
              id: test.id,
              status: 'fail',
              error: `${err.message} (at ${window.location.href})`,
            });
          },
          onSkip: (test) => {
            test.status = 'done';
            testStatus.push({ id: test.id, status: 'skip' });
          },
        },
        { retryCount }
      );
      const handlers = await runner.runByIds(myIds);
      return { handlers: Array.from(handlers.values()), testStatus };
    },
    workerIndex,
    WORKERS,
    config.retryCount
  );

  // Always dump coverage when enabled — including on failures, unlike serial.
  if (config.coverage) {
    const coverage = await page.evaluate(() => window.__coverage__);
    if (coverage) {
      const nycDir = path.resolve(workingDir, config.nycOutputDir);
      const outPath = path.join(nycDir, `out-${workerIndex}.json`);
      fs.writeFileSync(outPath, JSON.stringify(coverage));
      console.log(`Worker ${workerIndex}: coverage → ${outPath}`);
    } else {
      console.log(`Worker ${workerIndex}: no __coverage__ on window`);
    }
  }

  await ctx.close();
  return { workerIndex, handlers, testStatus };
}

export async function runParallel(config, workingDir, contractValidators) {
  let browser;
  try {
    console.log(`Starting TWD test runner (parallel mode, ${WORKERS} workers)...`);
    console.log('Configuration:', JSON.stringify(config, null, 2));

    if (config.coverage) {
      const nycDir = path.resolve(workingDir, config.nycOutputDir);
      if (fs.existsSync(nycDir)) {
        fs.rmSync(nycDir, { recursive: true, force: true });
      }
      fs.mkdirSync(nycDir, { recursive: true });
    }

    browser = await puppeteer.launch({
      headless: config.headless,
      args: mergeArgs(config.puppeteerArgs, ANTI_THROTTLE_FLAGS),
    });

    console.time('Parallel test time');
    const workerResults = await Promise.all(
      Array.from({ length: WORKERS }, (_, i) =>
        runWorker(browser, i, config, workingDir)
      )
    );
    console.timeEnd('Parallel test time');

    let totalPass = 0;
    let totalFail = 0;
    let totalSkip = 0;
    for (const { workerIndex, handlers, testStatus } of workerResults) {
      console.log(`\n────── Worker ${workerIndex} results ──────`);
      reportResults(handlers, testStatus);
      const pass = testStatus.filter((s) => s.status === 'pass').length;
      const fail = testStatus.filter((s) => s.status === 'fail').length;
      const skip = testStatus.filter((s) => s.status === 'skip').length;
      console.log(
        `Worker ${workerIndex}: ${pass} passed, ${fail} failed, ${skip} skipped`
      );
      totalPass += pass;
      totalFail += fail;
      totalSkip += skip;
    }

    console.log(`\n────── Summary ──────`);
    console.log(
      `Total: ${totalPass} passed, ${totalFail} failed, ${totalSkip} skipped`
    );

    const hasFailures = totalFail > 0;

    await browser.close();
    console.log('Browser closed.');
    return hasFailures;
  } catch (error) {
    console.error('Error running tests (parallel):', error);
    if (browser) await browser.close();
    throw error;
  }
}
```

### Step 4: Run the test — expect all pass

```bash
cd /Users/kevinccbsg/brikev/twd-cli
npx vitest run tests/runParallel.test.js
```

Expected: all tests in `tests/runParallel.test.js` pass.

### Step 5: Also run the full test suite — ensure nothing regressed

```bash
cd /Users/kevinccbsg/brikev/twd-cli
npx vitest run
```

Expected: every existing test still passes. `tests/runTests.test.js` is unaffected because `runTests()` in `index.js` hasn't changed yet.

### Step 6: Stage and propose commit (DO NOT COMMIT)

```bash
cd /Users/kevinccbsg/brikev/twd-cli
git add src/runParallel.js tests/runParallel.test.js
```

Proposed commit message:
```
feat(runParallel): add core parallel execution module (no contracts)

Introduces src/runParallel.js. Launches one Puppeteer browser with
anti-throttle flags, creates two isolated browser contexts, navigates
each to the configured URL, runs a test chunk via runByIds (self-filtered
by idx % N === workerIndex inside page.evaluate), dumps per-worker
window.__coverage__ to .nyc_output/out-<i>.json, and aggregates pass/
fail/skip counts. Contract mock collection and merging land in the next
commit. Not yet wired into src/index.js.
```

Wait for user approval.

---

## Task 4: `runParallel` — contract mock collection and merge

**Files:**
- Modify: `/Users/kevinccbsg/brikev/twd-cli/tests/runParallel.test.js`
- Modify: `/Users/kevinccbsg/brikev/twd-cli/src/runParallel.js`

This task wires per-worker `exposeFunction('__twdCollectMock', ...)`, merges the collected mocks via `mergeMocks`, enriches them with testName via `buildTestPath` using each mock's `workerIndex` to pick the right handler tree, and feeds them through the existing `validateMocks` / `printContractReport` pipeline.

### Step 1: Add contract tests to `tests/runParallel.test.js`

Append the following inside the `describe('runParallel', ...)` block in `/Users/kevinccbsg/brikev/twd-cli/tests/runParallel.test.js`:

```javascript
  it('exposes __twdCollectMock on each page when contracts are configured', async () => {
    const page0 = createMockPage({ handlers: [], testStatus: [] });
    const page1 = createMockPage({ handlers: [], testStatus: [] });
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    const { validateMocks } = await import('../src/contracts.js');
    const { printContractReport } = await import('../src/contractReport.js');
    vi.mocked(validateMocks).mockReturnValue({ results: [], skipped: [] });
    vi.mocked(printContractReport).mockReturnValue(false);

    await runParallel(
      { ...baseConfig, contracts: [{ source: './openapi.json' }] },
      '/cwd',
      [{ /* sentinel validator */ }]
    );

    expect(page0.exposeFunction).toHaveBeenCalledWith(
      '__twdCollectMock',
      expect.any(Function)
    );
    expect(page1.exposeFunction).toHaveBeenCalledWith(
      '__twdCollectMock',
      expect.any(Function)
    );
  });

  it('does not expose __twdCollectMock when contracts are not configured', async () => {
    const page0 = createMockPage({ handlers: [], testStatus: [] });
    const page1 = createMockPage({ handlers: [], testStatus: [] });
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runParallel(baseConfig, '/cwd', []);

    expect(page0.exposeFunction).not.toHaveBeenCalled();
    expect(page1.exposeFunction).not.toHaveBeenCalled();
  });

  it('feeds merged mocks (with workerIndex) into validateMocks', async () => {
    // Drive each worker's exposed __twdCollectMock callback from inside
    // that worker's page.evaluate, so it closes over the right closure.
    function makePage(workerHandlers, workerTestStatus, mockToCollect) {
      const page = {
        goto: vi.fn(),
        waitForSelector: vi.fn(),
        exposeFunction: vi.fn(),
        evaluate: vi.fn(),
      };
      page.evaluate
        .mockImplementationOnce(async () => {
          const exposed = page.exposeFunction.mock.calls.find(
            (c) => c[0] === '__twdCollectMock'
          );
          expect(exposed).toBeDefined();
          const collect = exposed[1];
          await collect(mockToCollect);
          return { handlers: workerHandlers, testStatus: workerTestStatus };
        })
        .mockResolvedValueOnce(null); // no coverage
      return page;
    }

    const page0 = makePage(
      [{ id: 't-0', name: 'describe0 > test0', type: 'test' }],
      [{ id: 't-0', status: 'pass' }],
      {
        alias: 'getA',
        method: 'GET',
        url: '/api/a',
        status: 200,
        response: 'x',
        testId: 't-0',
      }
    );
    const page1 = makePage(
      [{ id: 't-1', name: 'describe1 > test1', type: 'test' }],
      [{ id: 't-1', status: 'pass' }],
      {
        alias: 'getB',
        method: 'GET',
        url: '/api/b',
        status: 200,
        response: 'y',
        testId: 't-1',
      }
    );
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    const { validateMocks } = await import('../src/contracts.js');
    const { printContractReport } = await import('../src/contractReport.js');
    let capturedMocks;
    vi.mocked(validateMocks).mockImplementation((mocks) => {
      capturedMocks = mocks;
      return { results: [], skipped: [] };
    });
    vi.mocked(printContractReport).mockReturnValue(false);

    await runParallel(
      { ...baseConfig, contracts: [{ source: './openapi.json' }] },
      '/cwd',
      [{ /* sentinel */ }]
    );

    expect(capturedMocks).toBeDefined();
    const entries = Array.from(capturedMocks.values());
    expect(entries).toHaveLength(2);
    const aliases = entries.map((e) => e.alias).sort();
    expect(aliases).toEqual(['getA', 'getB']);
    const workerIndices = entries.map((e) => e.workerIndex).sort();
    expect(workerIndices).toEqual([0, 1]);
  });

  it('returns true when contract errors are printed', async () => {
    const page0 = createMockPage({ handlers: [], testStatus: [] });
    const page1 = createMockPage({ handlers: [], testStatus: [] });
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    const { validateMocks } = await import('../src/contracts.js');
    const { printContractReport } = await import('../src/contractReport.js');
    vi.mocked(validateMocks).mockReturnValue({ results: [], skipped: [] });
    vi.mocked(printContractReport).mockReturnValue(true); // simulate errors

    const hasFailures = await runParallel(
      { ...baseConfig, contracts: [{ source: './openapi.json' }] },
      '/cwd',
      [{ /* sentinel */ }]
    );

    expect(hasFailures).toBe(true);
  });
```

### Step 2: Run the new tests — expect failure (contracts not yet handled in runParallel)

```bash
cd /Users/kevinccbsg/brikev/twd-cli
npx vitest run tests/runParallel.test.js
```

Expected: the four new tests fail. For example, `expect(page0.exposeFunction).toHaveBeenCalledWith(...)` fails because `runParallel` currently never calls `exposeFunction`.

### Step 3: Extend `src/runParallel.js` with contract handling

Edit `/Users/kevinccbsg/brikev/twd-cli/src/runParallel.js`. Replace the file with:

```javascript
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import { reportResults } from 'twd-js/runner-ci';
import { validateMocks } from './contracts.js';
import { printContractReport } from './contractReport.js';
import { generateContractMarkdown } from './contractMarkdown.js';
import { buildTestPath } from './buildTestPath.js';
import { mergeMocks } from './mergeMocks.js';

const WORKERS = 2;

const ANTI_THROTTLE_FLAGS = [
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
];

function mergeArgs(userArgs, extras) {
  const merged = [...userArgs];
  for (const flag of extras) {
    if (!merged.includes(flag)) merged.push(flag);
  }
  return merged;
}

function makeMockCollector(workerMocks, workerCounters) {
  return (mock) => {
    const occKey = `${mock.alias}:${mock.testId}`;
    const count = (workerCounters.get(occKey) || 0) + 1;
    workerCounters.set(occKey, count);
    const dedupKey = `${mock.method}:${mock.url}:${mock.status}:${mock.testId}:${count}`;
    workerMocks.set(dedupKey, { ...mock, occurrence: count });
  };
}

async function runWorker(browser, workerIndex, config, workingDir, contractsConfigured, workerMocks, workerCounters) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();

  if (contractsConfigured) {
    await page.exposeFunction(
      '__twdCollectMock',
      makeMockCollector(workerMocks, workerCounters)
    );
  }

  await page.goto(config.url);
  await page.waitForSelector('#twd-sidebar-root', { timeout: config.timeout });

  const { handlers, testStatus } = await page.evaluate(
    async (workerIndex, N, retryCount) => {
      const allIds = Array.from(window.__TWD_STATE__.handlers.values())
        .filter((h) => h.type === 'test')
        .map((h) => h.id);
      const myIds = allIds.filter((_, idx) => idx % N === workerIndex);

      const TestRunner = window.__testRunner;
      const testStatus = [];
      const runner = new TestRunner(
        {
          onStart: (test) => { test.status = 'running'; },
          onPass: (test, retryAttempt) => {
            test.status = 'done';
            const entry = { id: test.id, status: 'pass' };
            if (retryAttempt !== undefined) entry.retryAttempt = retryAttempt;
            testStatus.push(entry);
          },
          onFail: (test, err) => {
            test.status = 'done';
            testStatus.push({
              id: test.id,
              status: 'fail',
              error: `${err.message} (at ${window.location.href})`,
            });
          },
          onSkip: (test) => {
            test.status = 'done';
            testStatus.push({ id: test.id, status: 'skip' });
          },
        },
        { retryCount }
      );
      const handlers = await runner.runByIds(myIds);
      return { handlers: Array.from(handlers.values()), testStatus };
    },
    workerIndex,
    WORKERS,
    config.retryCount
  );

  if (config.coverage) {
    const coverage = await page.evaluate(() => window.__coverage__);
    if (coverage) {
      const nycDir = path.resolve(workingDir, config.nycOutputDir);
      const outPath = path.join(nycDir, `out-${workerIndex}.json`);
      fs.writeFileSync(outPath, JSON.stringify(coverage));
      console.log(`Worker ${workerIndex}: coverage → ${outPath}`);
    } else {
      console.log(`Worker ${workerIndex}: no __coverage__ on window`);
    }
  }

  await ctx.close();
  return { workerIndex, handlers, testStatus };
}

export async function runParallel(config, workingDir, contractValidators) {
  let browser;
  try {
    console.log(`Starting TWD test runner (parallel mode, ${WORKERS} workers)...`);
    console.log('Configuration:', JSON.stringify(config, null, 2));

    const contractsConfigured = config.contracts && config.contracts.length > 0;
    const workerMocks = Array.from({ length: WORKERS }, () => new Map());
    const workerCounters = Array.from({ length: WORKERS }, () => new Map());

    if (config.coverage) {
      const nycDir = path.resolve(workingDir, config.nycOutputDir);
      if (fs.existsSync(nycDir)) {
        fs.rmSync(nycDir, { recursive: true, force: true });
      }
      fs.mkdirSync(nycDir, { recursive: true });
    }

    browser = await puppeteer.launch({
      headless: config.headless,
      args: mergeArgs(config.puppeteerArgs, ANTI_THROTTLE_FLAGS),
    });

    console.time('Parallel test time');
    const workerResults = await Promise.all(
      Array.from({ length: WORKERS }, (_, i) =>
        runWorker(
          browser,
          i,
          config,
          workingDir,
          contractsConfigured,
          workerMocks[i],
          workerCounters[i]
        )
      )
    );
    console.timeEnd('Parallel test time');

    let totalPass = 0;
    let totalFail = 0;
    let totalSkip = 0;
    for (const { workerIndex, handlers, testStatus } of workerResults) {
      console.log(`\n────── Worker ${workerIndex} results ──────`);
      reportResults(handlers, testStatus);
      const pass = testStatus.filter((s) => s.status === 'pass').length;
      const fail = testStatus.filter((s) => s.status === 'fail').length;
      const skip = testStatus.filter((s) => s.status === 'skip').length;
      console.log(
        `Worker ${workerIndex}: ${pass} passed, ${fail} failed, ${skip} skipped`
      );
      totalPass += pass;
      totalFail += fail;
      totalSkip += skip;
    }

    console.log(`\n────── Summary ──────`);
    console.log(
      `Total: ${totalPass} passed, ${totalFail} failed, ${totalSkip} skipped`
    );

    let hasFailures = totalFail > 0;

    if (contractsConfigured) {
      const merged = mergeMocks(workerMocks);

      // Enrich each mock with testName using its source worker's handler tree.
      for (const [, mock] of merged) {
        if (mock.testId) {
          const workerHandlers = workerResults[mock.workerIndex].handlers;
          mock.testName = buildTestPath(mock.testId, workerHandlers);
        }
      }

      if (merged.size === 0) {
        console.log('\nNo mocks collected — ensure twd-js supports contract collection');
      }
      const validationOutput = validateMocks(merged, contractValidators);
      const hasContractErrors = printContractReport(validationOutput);
      if (hasContractErrors) hasFailures = true;

      if (config.contractReportPath) {
        const reportPath = path.resolve(workingDir, config.contractReportPath);
        const reportDir = path.dirname(reportPath);
        if (!fs.existsSync(reportDir)) {
          fs.mkdirSync(reportDir, { recursive: true });
        }
        const markdown = generateContractMarkdown(validationOutput);
        fs.writeFileSync(reportPath, markdown);
        console.log(`Contract report written to ${config.contractReportPath}`);
      }
    }

    await browser.close();
    console.log('Browser closed.');
    return hasFailures;
  } catch (error) {
    console.error('Error running tests (parallel):', error);
    if (browser) await browser.close();
    throw error;
  }
}
```

### Step 4: Run the tests — expect all `runParallel` tests pass

```bash
cd /Users/kevinccbsg/brikev/twd-cli
npx vitest run tests/runParallel.test.js
```

Expected: all tests pass (core tests from Task 3 + 4 contract tests from this task).

### Step 5: Run the full suite — no regressions

```bash
cd /Users/kevinccbsg/brikev/twd-cli
npx vitest run
```

Expected: every test passes.

### Step 6: Stage and propose commit (DO NOT COMMIT)

```bash
cd /Users/kevinccbsg/brikev/twd-cli
git add src/runParallel.js tests/runParallel.test.js
```

Proposed commit message:
```
feat(runParallel): wire contract mock collection across workers

Each worker exposes its own __twdCollectMock via page.exposeFunction,
writing into a per-worker Map. After both workers complete, mergeMocks
combines them with worker-indexed keys. Each mock carries workerIndex
so buildTestPath can pick the correct handler tree for testName
resolution. Validation and markdown reporting reuse the existing
serial pipeline unchanged.
```

Wait for user approval.

---

## Task 5: Wire `runParallel` into `src/index.js`

**Files:**
- Modify: `/Users/kevinccbsg/brikev/twd-cli/src/index.js`
- Modify: `/Users/kevinccbsg/brikev/twd-cli/tests/runTests.test.js`

Adds the thin `if (config.parallel)` branch at the top of `runTests()`. The existing serial body remains textually below, unchanged.

### Step 1: Add a test in `tests/runTests.test.js` asserting serial path is NOT entered when `parallel: true`

Append to `/Users/kevinccbsg/brikev/twd-cli/tests/runTests.test.js` inside the `describe('runTests', ...)` block:

```javascript
  it("delegates to runParallel and does NOT launch a single-page serial flow when parallel=true", async () => {
    // When parallel mode is on, runTests should call runParallel (which
    // itself launches puppeteer with createBrowserContext). The serial code
    // path uses browser.newPage() on the default context. If parallel
    // dispatch works, page.evaluate should never be called via the serial
    // newPage() path — evidenced by puppeteer.launch being invoked exactly
    // once with args including the anti-throttle flags.
    const browser = {
      createBrowserContext: vi.fn().mockImplementation(() => ({
        newPage: vi.fn().mockResolvedValue({
          goto: vi.fn(),
          waitForSelector: vi.fn(),
          exposeFunction: vi.fn(),
          evaluate: vi.fn()
            .mockResolvedValueOnce({ handlers: [], testStatus: [] })
            .mockResolvedValueOnce(null),
        }),
        close: vi.fn(),
      })),
      newPage: vi.fn(), // serial path would call this — we assert it was NOT called
      close: vi.fn(),
    };
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig,
      parallel: true,
    });

    await runTests();

    expect(browser.newPage).not.toHaveBeenCalled();
    expect(browser.createBrowserContext).toHaveBeenCalledTimes(2);

    const launchArgs = vi.mocked(puppeteer.launch).mock.calls[0][0].args;
    expect(launchArgs).toContain('--disable-renderer-backgrounding');
  });

  it("runs the serial path when parallel is absent (default false)", async () => {
    const testStatus = [{ id: '1', status: 'pass' }];
    const handlers = [{ id: '1', name: 'test1', type: 'test' }];
    const page = createMockPage({ handlers, testStatus });
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    // defaultMockConfig has no `parallel` field — absent should mean serial.

    await runTests();

    expect(browser.newPage).toHaveBeenCalled();
    // Anti-throttle flags are a parallel-only behavior — NOT in the serial launch.
    const launchArgs = vi.mocked(puppeteer.launch).mock.calls[0][0].args;
    expect(launchArgs).not.toContain('--disable-renderer-backgrounding');
  });
```

### Step 2: Run the new tests — expect failures

```bash
cd /Users/kevinccbsg/brikev/twd-cli
npx vitest run tests/runTests.test.js
```

Expected: the two new tests fail. The first one fails because `runTests` ignores the `parallel` flag — the serial path runs and never calls `createBrowserContext`. The second passes incidentally (no change there) — but run both to confirm the first is the only failure.

### Step 3: Modify `src/index.js` to add the branch

Edit `/Users/kevinccbsg/brikev/twd-cli/src/index.js`. Insert the parallel import at the top of the import block:

```javascript
import { runParallel } from './runParallel.js';
```

And change the body of `runTests` so the parallel branch runs first. Replace:

```javascript
export async function runTests() {
  let browser;
  try {
    const config = loadConfig();
    const workingDir = process.cwd();

    console.log('Starting TWD test runner...');
    console.log('Configuration:', JSON.stringify(config, null, 2));

    // Load contract validators if configured
    let contractValidators = [];
    if (config.contracts && config.contracts.length > 0) {
      contractValidators = await loadContracts(config.contracts, workingDir);
    }

    browser = await puppeteer.launch({
```

with:

```javascript
export async function runTests() {
  const config = loadConfig();
  const workingDir = process.cwd();

  // Parallel mode — delegate early. Serial body below is unchanged.
  if (config.parallel) {
    let contractValidators = [];
    if (config.contracts && config.contracts.length > 0) {
      contractValidators = await loadContracts(config.contracts, workingDir);
    }
    return runParallel(config, workingDir, contractValidators);
  }

  let browser;
  try {
    console.log('Starting TWD test runner...');
    console.log('Configuration:', JSON.stringify(config, null, 2));

    // Load contract validators if configured
    let contractValidators = [];
    if (config.contracts && config.contracts.length > 0) {
      contractValidators = await loadContracts(config.contracts, workingDir);
    }

    browser = await puppeteer.launch({
```

Leave everything below this point in the file unchanged.

### Step 4: Run the new tests — expect pass

```bash
cd /Users/kevinccbsg/brikev/twd-cli
npx vitest run tests/runTests.test.js
```

Expected: all `runTests` tests pass, including the two new ones from Step 1.

### Step 5: Run the full suite — no regressions

```bash
cd /Users/kevinccbsg/brikev/twd-cli
npx vitest run
```

Expected: every test in the suite passes.

### Step 6: Stage and propose commit (DO NOT COMMIT)

```bash
cd /Users/kevinccbsg/brikev/twd-cli
git add src/index.js tests/runTests.test.js
```

Proposed commit message:
```
feat(index): delegate to runParallel when config.parallel is true

Adds an early-return branch at the top of runTests(): if
config.parallel is truthy, load contract validators and hand off to
runParallel. Serial code path below is textually unchanged and runs
when parallel is absent or false.
```

Wait for user approval.

---

## Task 6: Manual smoke acceptance + README update

**Files:**
- Modify: `/Users/kevinccbsg/brikev/twd-cli/README.md`

This task runs a real parallel run end-to-end and documents the feature. No code changes to `src/`.

### Step 1: Serial baseline against test-example-app

In a separate terminal, start the dev server and leave it running:
```bash
cd /Users/kevinccbsg/brikev/twd-cli/test-example-app
npm run dev
```

In a second terminal:
```bash
cd /Users/kevinccbsg/brikev/twd-cli/test-example-app
rm -rf .nyc_output
npx twd-cli run
```

Record: total test count, pass/fail/skip counts, wallclock `Total Test Time`. Expect all green (contract warnings ok — mode is `warn`).

### Step 2: Enable parallel and re-run

Edit `/Users/kevinccbsg/brikev/twd-cli/test-example-app/twd.config.json` to add one field:

```jsonc
{
  "url": "http://localhost:5173",
  "parallel": true,                 // NEW — opt-in
  "contractReportPath": ".twd/contract-report.md",
  "contracts": [ ... ]
}
```

Then:
```bash
cd /Users/kevinccbsg/brikev/twd-cli/test-example-app
rm -rf .nyc_output
npx twd-cli run
```

Expected output shape:
```
Starting TWD test runner (parallel mode, 2 workers)...
...
────── Worker 0 results ──────
<tree>
Worker 0: X passed, 0 failed, 0 skipped
────── Worker 1 results ──────
<tree>
Worker 1: Y passed, 0 failed, 0 skipped
────── Summary ──────
Total: (X+Y) passed, 0 failed, 0 skipped
Parallel test time: <faster than serial>
[contract report block — same lines as serial, counts may differ by ±1 because the collected occurrence ordering differs]
```

Check:
- Total pass count equals serial baseline.
- `Parallel test time` is less than serial's `Total Test Time`.
- Exit code 0 (run `echo $?` immediately after).

**Note on coverage for this target app**: `test-example-app` does not currently have istanbul instrumentation wired up. The script will log `Worker N: no __coverage__ on window` for each worker, and `.nyc_output/` will be created but contain no `out-<i>.json` files. That is expected and out of scope for this feature. The coverage path is unit-tested; real instrumentation is a separate change to `test-example-app/vite.config.ts`.

### Step 3: Revert the config change on test-example-app

```bash
cd /Users/kevinccbsg/brikev/twd-cli
git checkout test-example-app/twd.config.json
```

We do NOT want to ship `parallel: true` as the default for the example app — the feature is opt-in.

### Step 4: Add a README section documenting the new field

Edit `/Users/kevinccbsg/brikev/twd-cli/README.md`. Find the existing configuration section (search for `twd.config.json` or the `retryCount` docs). Add a new subsection:

```markdown
### Parallel Test Execution (Experimental)

Set `parallel: true` in `twd.config.json` to run tests across two isolated
Puppeteer browser contexts in parallel. On a typical developer laptop this
halves wallclock test time for suites over ~15 seconds. The feature is
opt-in; default remains `false` and existing behavior is unchanged.

```jsonc
{
  "url": "http://localhost:5173",
  "parallel": true,
  "retryCount": 2
}
```

**Notes:**
- Worker count is currently fixed at 2. Higher counts need tuning (see
  `poc/parallel/README.md` for the concurrency-ceiling findings).
- Coverage writes one file per worker to `.nyc_output/out-<i>.json`.
  `npx nyc report` merges them automatically — no new tooling required.
- Contract validation works unchanged. Mocks are collected per worker and
  merged before validation.
- Existing `retryCount` is honored per worker; timing-sensitive tests
  (e.g. `waitFor` with short timeouts) may be flakier under CPU contention
  — retries absorb this on most CI runners.
```

### Step 5: Stage and propose commit (DO NOT COMMIT)

```bash
cd /Users/kevinccbsg/brikev/twd-cli
git add README.md
```

Proposed commit message:
```
docs: document opt-in parallel test execution in README

Adds a section covering the new `parallel: true` config field, the
expected speedup, and the current N=2 limitation.
```

Wait for user approval.

---

## Completion

Once Tasks 1-6 are all staged and (per user direction) committed:

1. The production feature is live on `feat/parallel-execution`.
2. Serial path is byte-identical when `parallel` is absent or `false`.
3. Parallel path at N=2 gives ~1.5-1.8× speedup with full retries, coverage, and contract support.
4. Known follow-ups (tracked in the spec):
   - Deterministic test IDs in `twd-js` (unblocks unified reporting and cross-machine sharding).
   - Configurable `workers: N` once deterministic IDs land.
   - Canonical-path-merged unified reporting tree.
   - Istanbul instrumentation for `test-example-app` (separate concern from this feature).

Manual-verify commands for the release notes:

```bash
# Regression check: serial output byte-identical when parallel absent
npx twd-cli run           # existing behavior, unchanged

# Feature check: parallel mode
echo '{"parallel": true}' > twd.config.local.json  # or edit existing file
npx twd-cli run           # new output shape, ~50% wallclock

# Coverage merge (on an instrumented app)
npx nyc report --reporter=text
```

The feature is merge-ready when all unit tests pass, manual smoke shows
equal pass/fail counts vs serial, and the README documents the new flag.
