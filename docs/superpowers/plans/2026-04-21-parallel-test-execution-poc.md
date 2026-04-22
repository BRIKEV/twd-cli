# Parallel Test Execution POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a throwaway Node script under `poc/parallel/` that runs the `test-example-app` TWD test suite in parallel across N isolated Puppeteer browser contexts, writes per-worker coverage, and captures findings in a README — to prove service-worker isolation and coverage split work before designing a production feature.

**Architecture:** Single `puppeteer.launch()` → N `browser.createBrowserContext()` workers running in `Promise.all`. Worker 0 doubles as probe: it navigates first, reads test IDs from `window.__TWD_STATE__.handlers`, round-robin splits them, then all workers run `window.__testRunner.runByIds(chunk)` in parallel. Each worker dumps `window.__coverage__` to `.nyc_output/out-<i>.json`. No new dependencies; no changes to `src/` or the published `runTests()`.

**Tech Stack:** Node.js (ESM), Puppeteer (already in `twd-cli/node_modules`), `twd-js` in-browser `__testRunner`, existing nyc setup in `test-example-app`.

---

## ⚠ Commit Policy for This Plan

Per project convention (see memory), **the executor MUST NOT run `git commit` without explicit user approval in the current turn.** Every "commit" step below is written as *stage + propose*: run `git add`, show the proposed commit message, then pause for the user to say "commit". Never bundle `git add` and `git commit` together autonomously.

The feature branch `feat/parallel-execution` is already checked out and current with `main`. No branch creation needed.

---

## Prerequisites (one-time, before starting Task 1)

1. The dev server must be running in `test-example-app/`. In a separate terminal, the user should run:
   ```bash
   cd /Users/kevinccbsg/brikev/twd-cli/test-example-app
   npm run dev
   ```
   This starts Vite on `http://localhost:5173`. Leave it running for the entire POC.

2. Verify the baseline serial CLI works before starting — no point writing parallel if the serial run is broken:
   ```bash
   cd /Users/kevinccbsg/brikev/twd-cli/test-example-app
   rm -rf .nyc_output
   npx twd-cli run
   ```
   Expected: test tree prints, all tests pass (contract warnings OK in `warn` mode), `.nyc_output/out.json` is written, exit code 0. Note the total test count — we'll use it as the oracle for Task 7.

---

## File Structure

**Files to create:**
- `poc/parallel/run-parallel.js` — the POC script (ESM, ~150 LoC)
- `poc/parallel/README.md` — findings log + how to run

**Files to modify:** None. The POC is strictly additive and does not touch `src/`, `bin/`, `package.json`, or existing tests.

---

## Task 1: Scaffold the POC directory and stub script

**Files:**
- Create: `/Users/kevinccbsg/brikev/twd-cli/poc/parallel/run-parallel.js`
- Create: `/Users/kevinccbsg/brikev/twd-cli/poc/parallel/README.md`

- [ ] **Step 1: Create `poc/parallel/` directory**

```bash
mkdir -p /Users/kevinccbsg/brikev/twd-cli/poc/parallel
```

- [ ] **Step 2: Create `run-parallel.js` with argv parsing stub**

Create `/Users/kevinccbsg/brikev/twd-cli/poc/parallel/run-parallel.js` with this content:

```javascript
import fs from 'node:fs';
import path from 'node:path';

const URL = 'http://localhost:5173';
const NYC_DIR = path.resolve(process.cwd(), '.nyc_output');
const PUPPETEER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox'];
const TIMEOUT = 10000;

async function main() {
  const N = parseInt(process.argv[2], 10) || 2;
  console.log(`Parallel POC — N=${N}, URL=${URL}, NYC_DIR=${NYC_DIR}`);
}

main().catch((err) => {
  console.error('POC error:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Create `README.md` skeleton**

Create `/Users/kevinccbsg/brikev/twd-cli/poc/parallel/README.md` with this content:

```markdown
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

## Findings

_To be filled in after Task 8._
```

- [ ] **Step 4: Verify the scaffold runs**

Run:
```bash
cd /Users/kevinccbsg/brikev/twd-cli/test-example-app
node ../poc/parallel/run-parallel.js 3
```

Expected output:
```
Parallel POC — N=3, URL=http://localhost:5173, NYC_DIR=/Users/kevinccbsg/brikev/twd-cli/test-example-app/.nyc_output
```

If run without an arg, N should default to 2:
```bash
node ../poc/parallel/run-parallel.js
```
Expected: `... N=2, ...`

- [ ] **Step 5: Stage and propose commit (DO NOT COMMIT YET)**

```bash
cd /Users/kevinccbsg/brikev/twd-cli
git add poc/parallel/run-parallel.js poc/parallel/README.md
```

Proposed commit message:
```
poc(parallel): scaffold parallel test runner directory

Adds poc/parallel/{run-parallel.js,README.md} with an argv stub. No
puppeteer wiring yet. Standalone ESM script, runnable from
test-example-app/ as `node ../poc/parallel/run-parallel.js [N]`.
```

Wait for user approval before running `git commit`.

---

## Task 2: Launch browser, probe test IDs, round-robin split

**Files:**
- Modify: `/Users/kevinccbsg/brikev/twd-cli/poc/parallel/run-parallel.js`

This task wires Puppeteer in, navigates one page to the dev server, reads test IDs from `window.__TWD_STATE__.handlers`, splits them round-robin, and logs the chunks. Still single-threaded — no workers yet.

**Background context for the engineer:**
- TWD registers all tests at module load via `describe`/`it` calls. The registry lives on `window.__TWD_STATE__.handlers` (a `Map<id, Handler>`). Each `Handler` has a `type: 'suite' | 'test'` field — we only want `type === 'test'`.
- The page is "ready" when `#twd-sidebar-root` is in the DOM. This is the same readiness check the existing serial CLI uses (see `src/index.js:53`).
- Round-robin split spreads related tests across workers (useful because `test-example-app/src/App.twd.test.ts` clusters contract tests inside `describe` blocks).

- [ ] **Step 1: Add puppeteer import and launch**

Edit `run-parallel.js` — add `import puppeteer from 'puppeteer';` at the top alongside the other imports, then replace the body of `main` so the full file reads:

```javascript
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const URL = 'http://localhost:5173';
const NYC_DIR = path.resolve(process.cwd(), '.nyc_output');
const PUPPETEER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox'];
const TIMEOUT = 10000;

async function main() {
  const N = parseInt(process.argv[2], 10) || 2;
  console.log(`Parallel POC — N=${N}, URL=${URL}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: PUPPETEER_ARGS,
  });

  try {
    // Worker 0 doubles as the probe.
    const ctx0 = await browser.createBrowserContext();
    const page0 = await ctx0.newPage();
    await page0.goto(URL);
    await page0.waitForSelector('#twd-sidebar-root', { timeout: TIMEOUT });

    const testIds = await page0.evaluate(() => {
      return Array.from(window.__TWD_STATE__.handlers.values())
        .filter((h) => h.type === 'test')
        .map((h) => h.id);
    });
    console.log(`Discovered ${testIds.length} tests`);

    // Round-robin split
    const chunks = Array.from({ length: N }, () => []);
    testIds.forEach((id, i) => chunks[i % N].push(id));

    chunks.forEach((chunk, i) => {
      console.log(
        `Worker ${i}: ${chunk.length} tests, first=${chunk[0]}, last=${chunk[chunk.length - 1]}`
      );
    });
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('POC error:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the script and verify test discovery**

Ensure the dev server is running (see Prerequisites). Then:
```bash
cd /Users/kevinccbsg/brikev/twd-cli/test-example-app
node ../poc/parallel/run-parallel.js 2
```

Expected output (exact test count depends on the current state of `App.twd.test.ts`, but should be ~80+ tests):
```
Parallel POC — N=2, URL=http://localhost:5173
Discovered 80 tests
Worker 0: 40 tests, first=abc123xyz, last=def456uvw
Worker 1: 40 tests, first=xyz789abc, last=uvw012def
```

Two things to check manually:
- `Discovered N tests` where N > 0 — if 0, the probe isn't finding `__TWD_STATE__` (check the dev server is running and the sidebar is actually mounting).
- The `first=` IDs differ across workers — round-robin is working.

- [ ] **Step 3: Try N=3 and N=1 as sanity checks**

```bash
node ../poc/parallel/run-parallel.js 3
node ../poc/parallel/run-parallel.js 1
```

Expected: with N=3, three chunks of roughly equal size. With N=1, single chunk with all tests.

- [ ] **Step 4: Stage and propose commit (DO NOT COMMIT YET)**

```bash
cd /Users/kevinccbsg/brikev/twd-cli
git add poc/parallel/run-parallel.js
```

Proposed commit message:
```
poc(parallel): probe test IDs and round-robin split

Wires Puppeteer, navigates one browser context to the dev server,
reads window.__TWD_STATE__.handlers to enumerate tests, and splits
them round-robin into N chunks. Logs chunk sizes but does not run
any tests yet.
```

Wait for user approval.

---

## Task 3: Run worker 0's chunk (serial, one worker)

**Files:**
- Modify: `/Users/kevinccbsg/brikev/twd-cli/poc/parallel/run-parallel.js`

This task makes worker 0 actually execute its chunk via `runByIds` and report results. Still single-threaded — workers 1..N-1 come in Task 4.

**Background context:**
- `window.__testRunner` is the `TestRunner` class from `twd/src/runner.ts`. Its `runByIds(ids)` method runs only the tests whose IDs are in the set and invokes suite hooks correctly (see spec §"Test Distribution").
- The page.evaluate pattern here closely mirrors what `src/index.js:57-81` does, just with `runByIds` instead of `runAll` and without the retryCount logic.

- [ ] **Step 1: Extract a runWorker helper and wire it for worker 0**

Edit `run-parallel.js`. Replace the `main` function with:

```javascript
async function runWorker(workerIndex, chunk, page) {
  console.log(`Worker ${workerIndex}: starting ${chunk.length} tests`);
  const testStatus = await page.evaluate(async (ids) => {
    const TestRunner = window.__testRunner;
    const status = [];
    const runner = new TestRunner({
      onStart: () => {},
      onPass: (t) => status.push({ id: t.id, status: 'pass' }),
      onFail: (t, err) => status.push({
        id: t.id, status: 'fail', error: `${err.message} (at ${window.location.href})`,
      }),
      onSkip: (t) => status.push({ id: t.id, status: 'skip' }),
    });
    await runner.runByIds(ids);
    return status;
  }, chunk);
  return testStatus;
}

async function main() {
  const N = parseInt(process.argv[2], 10) || 2;
  console.log(`Parallel POC — N=${N}, URL=${URL}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: PUPPETEER_ARGS,
  });

  try {
    const ctx0 = await browser.createBrowserContext();
    const page0 = await ctx0.newPage();
    await page0.goto(URL);
    await page0.waitForSelector('#twd-sidebar-root', { timeout: TIMEOUT });

    const testIds = await page0.evaluate(() => {
      return Array.from(window.__TWD_STATE__.handlers.values())
        .filter((h) => h.type === 'test')
        .map((h) => h.id);
    });
    console.log(`Discovered ${testIds.length} tests`);

    const chunks = Array.from({ length: N }, () => []);
    testIds.forEach((id, i) => chunks[i % N].push(id));

    chunks.forEach((chunk, i) => {
      console.log(
        `Worker ${i}: ${chunk.length} tests, first=${chunk[0]}, last=${chunk[chunk.length - 1]}`
      );
    });

    // Run worker 0 only for now — workers 1..N-1 added in Task 4.
    const worker0Status = await runWorker(0, chunks[0], page0);
    const pass0 = worker0Status.filter((s) => s.status === 'pass').length;
    const fail0 = worker0Status.filter((s) => s.status === 'fail').length;
    console.log(`Worker 0 done: ${pass0} passed, ${fail0} failed`);
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 2: Run and verify worker 0 executes its chunk**

```bash
cd /Users/kevinccbsg/brikev/twd-cli/test-example-app
node ../poc/parallel/run-parallel.js 2
```

Expected output tail:
```
Worker 0: starting 40 tests
Worker 0 done: 40 passed, 0 failed
```

If any tests fail here, check against the serial baseline — it might be a real test failure unrelated to the POC, or the chunk selection is misbehaving.

- [ ] **Step 3: Stage and propose commit (DO NOT COMMIT YET)**

```bash
cd /Users/kevinccbsg/brikev/twd-cli
git add poc/parallel/run-parallel.js
```

Proposed commit message:
```
poc(parallel): run worker 0 chunk via runByIds

Extracts runWorker helper that calls window.__testRunner.runByIds
and collects per-test pass/fail/skip status. Currently runs only
worker 0; remaining workers added in the next commit.
```

Wait for user approval.

---

## Task 4: Parallel fan-out to remaining workers

**Files:**
- Modify: `/Users/kevinccbsg/brikev/twd-cli/poc/parallel/run-parallel.js`

This is the core parallelization step. Workers 1..N-1 each create their own `browser.createBrowserContext()`, navigate, wait for readiness, run their chunk, and close the context. All N workers execute in `Promise.all`.

- [ ] **Step 1: Wrap worker 0 and add workers 1..N-1 in Promise.all**

Edit `run-parallel.js`. Replace the `// Run worker 0 only for now` block (and what follows up to `} finally {`) with:

```javascript
    console.time('Parallel test time');

    const workerPromises = [runWorker(0, chunks[0], page0)];
    for (let i = 1; i < N; i++) {
      const workerIndex = i;
      const chunk = chunks[i];
      workerPromises.push((async () => {
        const ctx = await browser.createBrowserContext();
        const page = await ctx.newPage();
        await page.goto(URL);
        await page.waitForSelector('#twd-sidebar-root', { timeout: TIMEOUT });
        const result = await runWorker(workerIndex, chunk, page);
        await ctx.close();
        return result;
      })());
    }

    const results = await Promise.all(workerPromises);
    console.timeEnd('Parallel test time');

    results.forEach((status, i) => {
      const pass = status.filter((s) => s.status === 'pass').length;
      const fail = status.filter((s) => s.status === 'fail').length;
      console.log(`Worker ${i} done: ${pass} passed, ${fail} failed`);
    });
```

Note: we intentionally do NOT close `ctx0` here — it'll be cleaned up by `browser.close()` in the `finally`. Keeping it alive makes the code simpler (worker 0 is special because it ran the probe).

- [ ] **Step 2: Run with N=2 and verify both workers execute**

```bash
cd /Users/kevinccbsg/brikev/twd-cli/test-example-app
node ../poc/parallel/run-parallel.js 2
```

Expected output tail:
```
Worker 0: starting 40 tests
Worker 1: starting 40 tests
Worker 0 done: 40 passed, 0 failed
Worker 1 done: 40 passed, 0 failed
Parallel test time: XXXXms
```

Important checks:
- Both `Worker N: starting` lines appear before either `Worker N done` line — that means execution really did interleave.
- `Parallel test time` is less than the serial baseline's `Total Test Time` (directional — this is not a strict pass gate).

- [ ] **Step 3: Run with N=3 and N=4**

```bash
node ../poc/parallel/run-parallel.js 3
node ../poc/parallel/run-parallel.js 4
```

Expected: 3 or 4 worker lines, all with `0 failed`. If any worker has failures that weren't in the serial baseline, that's the **F1** failure mode (SW isolation broken) — record it and stop.

- [ ] **Step 4: Stage and propose commit (DO NOT COMMIT YET)**

```bash
cd /Users/kevinccbsg/brikev/twd-cli
git add poc/parallel/run-parallel.js
```

Proposed commit message:
```
poc(parallel): fan out N-1 workers in Promise.all

Workers 1..N-1 each open their own browser context, navigate, wait
for sidebar readiness, and run their chunk via runByIds. Worker 0
continues to run on the probe page. All workers execute concurrently
via Promise.all.
```

Wait for user approval.

---

## Task 5: Per-worker coverage dump

**Files:**
- Modify: `/Users/kevinccbsg/brikev/twd-cli/poc/parallel/run-parallel.js`

Each worker writes its coverage object to `.nyc_output/out-<workerIndex>.json` regardless of pass/fail (see spec §"Coverage Output"). `.nyc_output/` is cleaned at script start so stale files don't pollute the merge.

**Background context:**
- `window.__coverage__` is the istanbul coverage object, automatically populated by the babel/istanbul instrumentation the Vite app uses. It's a plain object keyed by absolute file path.
- `nyc` merges all `*.json` files in `.nyc_output/` automatically when you run `npx nyc report`. No manual merge step needed.

- [ ] **Step 1: Clear `.nyc_output/` at startup**

Edit `run-parallel.js`. At the top of `main`, after the initial `console.log` and before `puppeteer.launch`, add:

```javascript
  fs.rmSync(NYC_DIR, { recursive: true, force: true });
  fs.mkdirSync(NYC_DIR, { recursive: true });
```

- [ ] **Step 2: Dump coverage inside `runWorker`**

Edit `runWorker`. After the `page.evaluate(...)` that returns `testStatus`, and before `return testStatus;`, insert:

```javascript
  const coverage = await page.evaluate(() => window.__coverage__);
  if (coverage) {
    const outPath = path.join(NYC_DIR, `out-${workerIndex}.json`);
    fs.writeFileSync(outPath, JSON.stringify(coverage));
    console.log(`Worker ${workerIndex}: coverage → ${outPath}`);
  } else {
    console.log(`Worker ${workerIndex}: no __coverage__ on window`);
  }
```

Full `runWorker` should now look like:

```javascript
async function runWorker(workerIndex, chunk, page) {
  console.log(`Worker ${workerIndex}: starting ${chunk.length} tests`);
  const testStatus = await page.evaluate(async (ids) => {
    const TestRunner = window.__testRunner;
    const status = [];
    const runner = new TestRunner({
      onStart: () => {},
      onPass: (t) => status.push({ id: t.id, status: 'pass' }),
      onFail: (t, err) => status.push({
        id: t.id, status: 'fail', error: `${err.message} (at ${window.location.href})`,
      }),
      onSkip: (t) => status.push({ id: t.id, status: 'skip' }),
    });
    await runner.runByIds(ids);
    return status;
  }, chunk);

  const coverage = await page.evaluate(() => window.__coverage__);
  if (coverage) {
    const outPath = path.join(NYC_DIR, `out-${workerIndex}.json`);
    fs.writeFileSync(outPath, JSON.stringify(coverage));
    console.log(`Worker ${workerIndex}: coverage → ${outPath}`);
  } else {
    console.log(`Worker ${workerIndex}: no __coverage__ on window`);
  }

  return testStatus;
}
```

- [ ] **Step 3: Run and verify coverage files land**

```bash
cd /Users/kevinccbsg/brikev/twd-cli/test-example-app
node ../poc/parallel/run-parallel.js 2
ls -la .nyc_output/
```

Expected:
- `Worker 0: coverage → .../out-0.json` line in POC output
- `Worker 1: coverage → .../out-1.json` line
- `ls` shows `out-0.json` and `out-1.json`, both non-empty (file size > 1 KB, usually much more)

If a worker logs `no __coverage__ on window`, the Vite app isn't instrumenting (unrelated to POC — same issue would break serial coverage). Check the `vite.config.ts` in `test-example-app/`.

- [ ] **Step 4: Verify nyc can merge both files**

```bash
cd /Users/kevinccbsg/brikev/twd-cli/test-example-app
npx nyc report --reporter=text
```

Expected: a coverage table with file paths, percentages, no errors. If `nyc` errors out, record the exact error for the **F2** failure mode.

- [ ] **Step 5: Stage and propose commit (DO NOT COMMIT YET)**

```bash
cd /Users/kevinccbsg/brikev/twd-cli
git add poc/parallel/run-parallel.js
```

Proposed commit message:
```
poc(parallel): dump per-worker coverage to out-<i>.json

Each worker writes window.__coverage__ to .nyc_output/out-<i>.json
after its chunk finishes, regardless of pass/fail. .nyc_output/ is
cleaned at script start to avoid stale data in the merge. User
verifies with `npx nyc report`.
```

Wait for user approval.

---

## Task 6: Aggregated summary output and exit code

**Files:**
- Modify: `/Users/kevinccbsg/brikev/twd-cli/poc/parallel/run-parallel.js`

Finish the output so the script prints a clear summary and exits with the right code.

- [ ] **Step 1: Add totals block and exit code**

Edit `run-parallel.js`. Replace the `results.forEach(...)` block from Task 4 with:

```javascript
    let totalPass = 0;
    let totalFail = 0;
    let totalSkip = 0;
    results.forEach((status, i) => {
      const pass = status.filter((s) => s.status === 'pass').length;
      const fail = status.filter((s) => s.status === 'fail').length;
      const skip = status.filter((s) => s.status === 'skip').length;
      totalPass += pass;
      totalFail += fail;
      totalSkip += skip;
      console.log(`Worker ${i} done: ${pass} passed, ${fail} failed, ${skip} skipped`);
    });
    console.log(
      `Total: ${totalPass} passed, ${totalFail} failed, ${totalSkip} skipped ` +
      `(expected ${testIds.length})`
    );

    if (totalPass + totalFail + totalSkip !== testIds.length) {
      console.warn(
        `WARNING: total reported (${totalPass + totalFail + totalSkip}) ` +
        `does not match discovered test count (${testIds.length}) — ` +
        `chunks may be dropping IDs`
      );
    }

    if (totalFail > 0) {
      process.exitCode = 1;
    }
```

Also print the list of failures (if any) right before the totals block so they're easy to spot:

```javascript
    results.forEach((status, i) => {
      const failures = status.filter((s) => s.status === 'fail');
      if (failures.length > 0) {
        console.log(`\nWorker ${i} failures:`);
        failures.forEach((f) => console.log(`  [${f.id}] ${f.error}`));
      }
    });
```

Insert this block **before** the counts block in step 1 so it reads: failures first, then per-worker counts, then total.

- [ ] **Step 2: Run with N=2 and verify clean output**

```bash
cd /Users/kevinccbsg/brikev/twd-cli/test-example-app
node ../poc/parallel/run-parallel.js 2
echo "Exit code: $?"
```

Expected:
```
...
Worker 0 done: 40 passed, 0 failed, 0 skipped
Worker 1 done: 40 passed, 0 failed, 0 skipped
Total: 80 passed, 0 failed, 0 skipped (expected 80)
Exit code: 0
```

(Actual test count depends on `App.twd.test.ts` — match the baseline from Prerequisites.)

- [ ] **Step 3: Verify exit code when forcing a failure**

Quick synthetic check: edit `test-example-app/src/App.twd.test.ts`, change one `twd.should(heading, "have.text", "Vite + React")` to `"have.text", "Definitely Wrong"`, re-run the POC, confirm exit code is 1, then **revert the change**.

Expected:
```
Worker N failures:
  [<id>] expected ... (at http://localhost:5173/)
Total: 79 passed, 1 failed, 0 skipped (expected 80)
Exit code: 1
```

Don't commit the test-file change — revert with `git checkout test-example-app/src/App.twd.test.ts` once confirmed.

- [ ] **Step 4: Stage and propose commit (DO NOT COMMIT YET)**

```bash
cd /Users/kevinccbsg/brikev/twd-cli
git add poc/parallel/run-parallel.js
```

Proposed commit message:
```
poc(parallel): print aggregated summary and set exit code

Adds per-worker failure listing, overall pass/fail/skip totals, and
an oracle warning when the aggregated count doesn't match the
discovered test count. process.exitCode = 1 when any worker failed.
```

Wait for user approval.

---

## Task 7: Baseline comparison run (verification, no code changes)

**Files:** None changed in this task — pure verification that feeds the findings log in Task 8.

The goal: prove success criteria (a), (b), (c) by comparing serial baseline vs parallel at N=2 and N=3 or N=4.

- [ ] **Step 1: Capture baseline (serial) counts and coverage**

```bash
cd /Users/kevinccbsg/brikev/twd-cli/test-example-app
rm -rf .nyc_output
npx twd-cli run 2>&1 | tee /tmp/baseline.log
npx nyc report --reporter=text 2>&1 | tee /tmp/baseline-cov.log
```

Record for later:
- Total test count (look for `Tests to report: N` line in baseline.log)
- Pass count, fail count, skip count (count from the tree or tail of the log)
- Overall coverage % from `baseline-cov.log` (last row of the table, "All files")
- Wallclock `Total Test Time` from the log

- [ ] **Step 2: Run parallel at N=2 and capture**

```bash
cd /Users/kevinccbsg/brikev/twd-cli/test-example-app
rm -rf .nyc_output
node ../poc/parallel/run-parallel.js 2 2>&1 | tee /tmp/parallel-n2.log
npx nyc report --reporter=text 2>&1 | tee /tmp/parallel-n2-cov.log
```

Record:
- Total counts from the `Total: ...` line
- Wallclock from `Parallel test time` line
- Overall coverage % from `parallel-n2-cov.log`

- [ ] **Step 3: Run parallel at N=3 and N=4, capture**

```bash
cd /Users/kevinccbsg/brikev/twd-cli/test-example-app
rm -rf .nyc_output
node ../poc/parallel/run-parallel.js 3 2>&1 | tee /tmp/parallel-n3.log
npx nyc report --reporter=text 2>&1 | tee /tmp/parallel-n3-cov.log

rm -rf .nyc_output
node ../poc/parallel/run-parallel.js 4 2>&1 | tee /tmp/parallel-n4.log
npx nyc report --reporter=text 2>&1 | tee /tmp/parallel-n4-cov.log
```

- [ ] **Step 4: Evaluate the three criteria**

For each of N=2, N=3, N=4, check:

**(c) Tests run to completion** — `Total: P passed, F failed, S skipped` line's sum equals the baseline total. Pass count matches baseline exactly. If fail count is higher than baseline, note which tests failed in the `Worker N failures:` lines — that's likely criterion (a) failing.

**(a) SW isolation** — derived: if (c) passes, (a) passes. Extra check: scan the parallel logs for any test ID that appears in failures for multiple workers (shouldn't happen; would indicate distribution bug, not isolation).

**(b) Coverage split** — `ls .nyc_output/` shows N files named `out-<i>.json`, all non-empty. `npx nyc report` produced a coherent table. The reported overall % is within ±2 percentage points of the baseline's overall %. (Exact match is unlikely because parallel execution order exercises slightly different code paths, but it should be very close.)

- [ ] **Step 5: Record observations**

Write down (on paper / in a scratch file / in a code comment — somewhere you can transcribe into the README in Task 8):

- Baseline: X tests, Y passed, Z failed, W% coverage, T seconds
- N=2: ...
- N=3: ...
- N=4: ...
- Any failure modes observed (F1/F2/F3/F4 from spec).
- Any surprises (flaky tests, unusual output, Puppeteer warnings).

This feeds directly into Task 8.

---

## Task 8: Write the findings log in README.md

**Files:**
- Modify: `/Users/kevinccbsg/brikev/twd-cli/poc/parallel/README.md`

Fill in the "Findings" section based on Task 7's observations. This is the artifact that justifies the POC's conclusion.

- [ ] **Step 1: Replace the placeholder with structured findings**

Edit `README.md`. Replace the `## Findings` section (currently just `_To be filled in after Task 8._`) with, verbatim structure, filled in with real numbers from Task 7:

```markdown
## Findings

**Date run:** YYYY-MM-DD
**Machine:** <e.g. macOS 14 M1 Pro, 16 GB>
**Node:** <output of `node --version`>
**Puppeteer:** <version from twd-cli/package.json>

### Numbers

| Run       | Tests | Passed | Failed | Skipped | Coverage % | Wallclock |
|-----------|-------|--------|--------|---------|------------|-----------|
| Baseline  |   80  |   80   |   0    |    0    |   72.1     |  42.3 s   |
| N=2       |   80  |   80   |   0    |    0    |   72.0     |  24.1 s   |
| N=3       |   80  |   80   |   0    |    0    |   71.9     |  18.9 s   |
| N=4       |   80  |   80   |   0    |    0    |   71.8     |  16.2 s   |

_(Above numbers are placeholders — replace with observed values.)_

### Criteria

- **(a) Service-worker isolation**: PASS / FAIL — <evidence: if all tests pass under parallel, SW registrations are isolated per browser context>.
- **(b) Coverage split**: PASS / FAIL — <evidence: out-<i>.json files present, nyc merged cleanly, overall % within ±2pp of baseline>.
- **(c) Tests run to completion**: PASS / FAIL — <evidence: aggregated pass/fail counts match baseline exactly>.

### Anomalies

- _List anything surprising: flaky tests, Puppeteer warnings, workers that took suspiciously long, etc. If nothing, write "None observed."_

### Recommendation

<One paragraph: should we move forward with a production feature based on this approach, or do we need to investigate something first? If F1 observed: fallback to separate puppeteer.launch() per worker. If F2: investigate coverage dir layout. If clean pass across the board: green-light production spec.>
```

- [ ] **Step 2: Verify the README renders sensibly**

```bash
cat /Users/kevinccbsg/brikev/twd-cli/poc/parallel/README.md
```

Sanity-check: no "YYYY-MM-DD" left, no "PASS / FAIL" placeholders left (committed to one or the other), no `<placeholder>` stubs.

- [ ] **Step 3: Stage and propose commit (DO NOT COMMIT YET)**

```bash
cd /Users/kevinccbsg/brikev/twd-cli
git add poc/parallel/README.md
```

Proposed commit message (adapt wording if outcome differs):
```
poc(parallel): document findings — all three criteria pass

Records baseline vs parallel results for N=2/3/4 and concludes SW
isolation holds across browser contexts and per-worker coverage
merges cleanly with nyc. Green-lights production feature design.
```

Wait for user approval.

---

## Completion

Once all 8 tasks are done and committed (at user direction):

1. The POC is captured on `feat/parallel-execution`.
2. The spec and findings are ready to feed into a follow-up "production parallel test execution" spec if the outcome was positive.
3. The POC script is NOT exported from the package and is NOT referenced by `bin/twd-cli.js` — nothing ships to npm from this work.

If the outcome was negative (any failure mode in the spec), the findings log captures the evidence so the next design iteration starts from real data rather than speculation.
