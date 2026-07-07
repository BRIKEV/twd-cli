# AI-Friendly Output & Error Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace twd-cli's verbose output with twd-relay's AI-optimized summary-block format and add actionable diagnostics for known infrastructure failures.

**Architecture:** In-place rewrite of the reporting layer. `src/testSummary.js` becomes a single `formatRunComplete()` returning the relay-style block; a new `src/diagnostics.js` maps known Puppeteer errors to cause+remediation messages; `src/index.js` drops the config dump, chatter, and the per-test tree (`reportResults` from twd-js); `bin/twd-cli.js` never exits silently. The `twd-js` dependency becomes removable.

**Tech Stack:** Node.js ESM (no TypeScript), vitest with mocked Puppeteer/fs, Puppeteer.

**Spec:** `docs/superpowers/specs/2026-07-06-ai-friendly-output-design.md` (approved).

## Global Constraints

- Output must mirror twd-relay's `run` format exactly: `--- Run complete ---` header, `  Passed: N | Failed: N | Skipped: N`, `  Duration: X.Xs` (`(durationMs / 1000).toFixed(1)`), failure marker `×` (U+00D7), retried marker `✓`.
- **No ANSI color codes** anywhere in the summary block.
- The `--- Run complete ---` block is always the **last** output of a completed run (coverage/contract lines print before it).
- Exit codes unchanged: 0 = all pass, 1 = any failure.
- Filter messages (`Filtering: running N test(s) matching --test filter(s).`, `No tests matched filter(s): ...`), coverage lines, and the contract report format are **unchanged**.
- Error messages interpolate actual config values (`config.url`, `config.timeout`), never hardcoded defaults.
- Node >= 18, ESM only (`"type": "module"`). Optional chaining is fine.
- Run tests with `npx vitest run <file>` (non-watch). Full suite: `npx vitest run`.
- All work happens on the existing `feat/ai-friendly-output` branch. Commit after each task (this repo allows autonomous commits on feat/* branches).

---

### Task 1: `formatRunComplete` formatter

Rewrite `src/testSummary.js` as one function returning the relay-style block. Delete `formatDuration.js` (the relay format makes it unused).

**Files:**
- Modify: `src/testSummary.js` (full rewrite)
- Test: `tests/testSummary.test.js` (full rewrite)
- Delete: `src/formatDuration.js`, `tests/formatDuration.test.js`

**Interfaces:**
- Consumes: `buildTestPath(testId, handlers)` from `src/buildTestPath.js` (exists; returns `'Suite > child > test'` or `null` if the id is unknown).
- Produces: `formatRunComplete({ testStatus, handlers, durationMs })` → `string` (the complete block, no trailing newline). `testStatus` entries are `{ id, status: 'pass'|'fail'|'skip', error?, retryAttempt? }`; `handlers` are `{ id, name, parent?, type }`. Task 3 calls this.

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `tests/testSummary.test.js` with:

```js
import { describe, it, expect } from 'vitest';
import { formatRunComplete } from '../src/testSummary.js';

const handlers = [
  { id: 's1', name: 'Login', type: 'suite' },
  { id: 't1', name: 'shows error on wrong password', parent: 's1', type: 'test' },
  { id: 't2', name: 'redirects on success', parent: 's1', type: 'test' },
  { id: 't3', name: 'validates email', parent: 's1', type: 'test' },
];

describe('formatRunComplete', () => {
  it('formats an all-pass run as the three-line block', () => {
    const block = formatRunComplete({
      testStatus: [
        { id: 't1', status: 'pass' },
        { id: 't2', status: 'pass' },
      ],
      handlers,
      durationMs: 4200,
    });
    expect(block).toBe(
      '--- Run complete ---\n' +
      '  Passed: 2 | Failed: 0 | Skipped: 0\n' +
      '  Duration: 4.2s'
    );
  });

  it('counts skipped tests', () => {
    const block = formatRunComplete({
      testStatus: [
        { id: 't1', status: 'pass' },
        { id: 't2', status: 'skip' },
      ],
      handlers,
      durationMs: 1000,
    });
    expect(block).toContain('  Passed: 1 | Failed: 0 | Skipped: 1');
  });

  it('appends the failure block with suite path and indented error', () => {
    const block = formatRunComplete({
      testStatus: [
        { id: 't1', status: 'fail', error: 'Expected element to be visible (at http://localhost:5173/login)' },
        { id: 't2', status: 'pass' },
        { id: 't3', status: 'fail', error: 'Timeout waiting for selector ".error"' },
      ],
      handlers,
      durationMs: 4200,
    });
    expect(block).toBe(
      '--- Run complete ---\n' +
      '  Passed: 1 | Failed: 2 | Skipped: 0\n' +
      '  Duration: 4.2s\n' +
      '\n' +
      '  Failed tests (2):\n' +
      '    × Login > shows error on wrong password\n' +
      '      Expected element to be visible (at http://localhost:5173/login)\n' +
      '    × Login > validates email\n' +
      '      Timeout waiting for selector ".error"'
    );
  });

  it('indents multi-line error messages to align under the test line', () => {
    const block = formatRunComplete({
      testStatus: [{ id: 't1', status: 'fail', error: 'line one\nline two' }],
      handlers,
      durationMs: 500,
    });
    expect(block).toContain('      line one\n      line two');
  });

  it('falls back to the test id when no handler matches', () => {
    const block = formatRunComplete({
      testStatus: [{ id: 'ghost-id', status: 'fail', error: 'boom' }],
      handlers: [],
      durationMs: 500,
    });
    expect(block).toContain('    × ghost-id');
  });

  it('omits the failure block when everything passes', () => {
    const block = formatRunComplete({
      testStatus: [{ id: 't1', status: 'pass' }],
      handlers,
      durationMs: 500,
    });
    expect(block).not.toContain('Failed tests');
  });

  it('appends the retried block for tests that passed on retry', () => {
    const block = formatRunComplete({
      testStatus: [
        { id: 't1', status: 'pass', retryAttempt: 2 },
        { id: 't2', status: 'pass' },
      ],
      handlers,
      durationMs: 500,
    });
    expect(block).toContain(
      '\n' +
      '  Retried (1):\n' +
      '    ✓ Login > shows error on wrong password (passed on attempt 2)'
    );
  });

  it('omits the retried block when no test was retried', () => {
    const block = formatRunComplete({
      testStatus: [{ id: 't1', status: 'pass' }],
      handlers,
      durationMs: 500,
    });
    expect(block).not.toContain('Retried');
  });

  it('contains no ANSI escape codes', () => {
    const block = formatRunComplete({
      testStatus: [
        { id: 't1', status: 'fail', error: 'boom' },
        { id: 't2', status: 'pass', retryAttempt: 2 },
        { id: 't3', status: 'skip' },
      ],
      handlers,
      durationMs: 500,
    });
    expect(/\x1b\[[0-9;]*m/.test(block)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/testSummary.test.js`
Expected: FAIL — `formatRunComplete` is not exported (`SyntaxError` or undefined import).

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `src/testSummary.js` with:

```js
import { buildTestPath } from './buildTestPath.js';

export function formatRunComplete({ testStatus, handlers, durationMs }) {
  const passed = testStatus.filter((t) => t.status === 'pass').length;
  const failed = testStatus.filter((t) => t.status === 'fail').length;
  const skipped = testStatus.filter((t) => t.status === 'skip').length;
  const duration = (durationMs / 1000).toFixed(1);

  const lines = [
    '--- Run complete ---',
    `  Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped}`,
    `  Duration: ${duration}s`,
  ];

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

  return lines.join('\n');
}
```

- [ ] **Step 4: Delete the now-unused duration formatter**

```bash
git rm src/formatDuration.js tests/formatDuration.test.js
```

(`formatDuration` was only imported by the old `testSummary.js` — verify with `grep -rn "formatDuration" src/ tests/ bin/`, which must return nothing.)

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `npx vitest run tests/testSummary.test.js`
Expected: PASS (9 tests).

Note: `npx vitest run` (full suite) still fails at this point — `src/index.js` imports `formatTestSummary`/`formatFailedTestsBlock`, which no longer exist. That is expected until Task 3; do not run the full suite as a gate here.

- [ ] **Step 6: Commit**

```bash
git add -A src/testSummary.js src/formatDuration.js tests/testSummary.test.js tests/formatDuration.test.js
git commit -m "feat: add relay-style formatRunComplete block formatter"
```

---

### Task 2: `explainError` diagnostics module

New module mapping known Puppeteer failures to actionable cause+remediation messages. Absorbs `isProtocolTimeout` from `src/index.js` (leave `index.js` untouched in this task; Task 3 rewires it).

**Files:**
- Create: `src/diagnostics.js`
- Test: `tests/diagnostics.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `explainError(error, config = {})` → `string | null` (diagnostic text for known failures, `null` for unknown) and `isProtocolTimeout(error)` → `boolean`. Task 3 calls both.

- [ ] **Step 1: Write the failing tests**

Create `tests/diagnostics.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { explainError, isProtocolTimeout } from '../src/diagnostics.js';

const config = { url: 'http://localhost:5173', timeout: 10000 };

describe('explainError', () => {
  it('explains connection refused with the configured url', () => {
    const err = new Error('net::ERR_CONNECTION_REFUSED at http://localhost:5173');
    const msg = explainError(err, config);
    expect(msg).toContain('Could not reach http://localhost:5173 (ERR_CONNECTION_REFUSED)');
    expect(msg).toContain('Is your dev server running?');
    expect(msg).toContain('"url" in twd.config.json');
  });

  it('explains DNS resolution failures', () => {
    const err = new Error('net::ERR_NAME_NOT_RESOLVED at http://myapp.local:5173');
    const msg = explainError(err, { ...config, url: 'http://myapp.local:5173' });
    expect(msg).toContain('Could not reach http://myapp.local:5173 (ERR_NAME_NOT_RESOLVED)');
  });

  it('explains unreachable-address failures', () => {
    const err = new Error('net::ERR_ADDRESS_UNREACHABLE at http://10.0.0.9:5173');
    expect(explainError(err, config)).toContain('(ERR_ADDRESS_UNREACHABLE)');
  });

  it('explains the sidebar selector timeout with the configured timeout', () => {
    const err = new Error(
      "Waiting for selector '#twd-sidebar-root' failed: Waiting failed: 10000ms exceeded"
    );
    err.name = 'TimeoutError';
    const msg = explainError(err, config);
    expect(msg).toContain('TWD sidebar (#twd-sidebar-root) did not appear within 10000ms');
    expect(msg).toContain('Ensure twd-js is initialized');
    expect(msg).toContain('raise "timeout" in twd.config.json');
  });

  it('does not claim a sidebar problem for unrelated TimeoutErrors', () => {
    const err = new Error('Waiting for selector ".other-thing" failed');
    err.name = 'TimeoutError';
    expect(explainError(err, config)).toBeNull();
  });

  it('explains protocol timeouts', () => {
    const err = new Error('Runtime.callFunctionOn timed out.');
    err.name = 'ProtocolError';
    const msg = explainError(err, config);
    expect(msg).toContain('protocolTimeout');
    expect(msg).toContain('twd.config.json');
  });

  it('explains a missing Chrome install', () => {
    const err = new Error('Could not find Chrome (ver. 131.0.6778.204).');
    const msg = explainError(err, config);
    expect(msg).toContain('Puppeteer could not launch Chrome');
    expect(msg).toContain('npx puppeteer browsers install chrome');
  });

  it('explains a browser process launch failure', () => {
    const err = new Error('Failed to launch the browser process!\nspawn ENOENT');
    const msg = explainError(err, config);
    expect(msg).toContain('Puppeteer could not launch Chrome');
    expect(msg).toContain('"puppeteerArgs" in twd.config.json');
  });

  it('returns null for unknown errors', () => {
    expect(explainError(new Error('something else entirely'), config)).toBeNull();
  });

  it('tolerates a missing config and non-Error values', () => {
    const err = new Error('net::ERR_CONNECTION_REFUSED at http://localhost:5173');
    expect(explainError(err)).toContain('Could not reach undefined (ERR_CONNECTION_REFUSED)');
    expect(explainError(null, config)).toBeNull();
    expect(explainError('boom', config)).toBeNull();
  });
});

describe('isProtocolTimeout', () => {
  it('matches ProtocolError timeouts', () => {
    const err = new Error('Runtime.callFunctionOn timed out.');
    err.name = 'ProtocolError';
    expect(isProtocolTimeout(err)).toBe(true);
  });

  it('matches messages that mention protocolTimeout', () => {
    expect(isProtocolTimeout(new Error('Increase the protocolTimeout setting'))).toBe(true);
  });

  it('rejects unrelated errors', () => {
    expect(isProtocolTimeout(new Error('boom'))).toBe(false);
    expect(isProtocolTimeout(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/diagnostics.test.js`
Expected: FAIL — cannot resolve `../src/diagnostics.js`.

- [ ] **Step 3: Write the implementation**

Create `src/diagnostics.js`:

```js
const NET_ERRORS = ['ERR_CONNECTION_REFUSED', 'ERR_NAME_NOT_RESOLVED', 'ERR_ADDRESS_UNREACHABLE'];

export function isProtocolTimeout(error) {
  const message = error && error.message ? error.message : '';
  return (
    (error && error.name === 'ProtocolError' && /timed out/i.test(message)) ||
    /protocolTimeout/i.test(message)
  );
}

export function explainError(error, config = {}) {
  if (!error || typeof error.message !== 'string') return null;
  const message = error.message;

  const netMatch = message.match(/net::(ERR_[A-Z_]+)/);
  if (netMatch && NET_ERRORS.includes(netMatch[1])) {
    return (
      `Could not reach ${config.url} (${netMatch[1]}).\n` +
      'Is your dev server running? Start it (e.g. `npm run dev`) or fix "url" in twd.config.json.'
    );
  }

  if (error.name === 'TimeoutError' && message.includes('#twd-sidebar-root')) {
    return (
      `Page loaded but the TWD sidebar (#twd-sidebar-root) did not appear within ${config.timeout}ms.\n` +
      'Ensure twd-js is initialized in your app and your tests are registered.\n' +
      'If the app is slow to start, raise "timeout" in twd.config.json.'
    );
  }

  if (isProtocolTimeout(error)) {
    return (
      'This looks like a Puppeteer protocolTimeout. The whole test suite runs in a single\n' +
      'page.evaluate call, so the run aborts if it takes longer than "protocolTimeout" (ms).\n' +
      'Raise it in twd.config.json, e.g. { "protocolTimeout": 600000 } (0 = no timeout).'
    );
  }

  if (/Could not find Chrome|Failed to launch the browser process/.test(message)) {
    return (
      'Puppeteer could not launch Chrome.\n' +
      'Run `npx puppeteer browsers install chrome`, or adjust "puppeteerArgs" in twd.config.json.'
    );
  }

  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/diagnostics.test.js`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/diagnostics.js tests/diagnostics.test.js
git commit -m "feat: add explainError diagnostics for known infrastructure failures"
```

---

### Task 3: Rewire `src/index.js` and `bin/twd-cli.js`

Slim the orchestrator: drop the config dump, chatter, and the `reportResults` tree; print `Running N test(s)...`; print the block last; use `explainError` in the catch; never exit silently from the bin.

**Files:**
- Modify: `src/index.js` (full rewrite below)
- Modify: `bin/twd-cli.js:13-15` (catch block)
- Test: `tests/runTests.test.js` (update mocks + assertions)

**Interfaces:**
- Consumes: `formatRunComplete({ testStatus, handlers, durationMs })` from Task 1; `explainError(error, config)` from Task 2.
- Produces: `runTests(options)` keeps its exact current signature and return (`Promise<boolean>` — `true` = failures). On error it sets `error.reported = true` after printing, rethrows; `bin/twd-cli.js` only prints `error.message` when `reported` is not set.

- [ ] **Step 1: Update the run-flow tests**

Apply these changes to `tests/runTests.test.js`:

**(a)** Delete the `twd-js/runner-ci` mock and import (lines 6-8 and 22):

```js
// DELETE these lines:
vi.mock('twd-js/runner-ci', () => ({
  reportResults: vi.fn(),
}));
// ...and:
import { reportResults } from 'twd-js/runner-ci';
```

**(b)** Replace the `createMockPage` helper — every run now starts with an enumeration `page.evaluate` (returns the registered handler list) before the run `page.evaluate`:

```js
function createMockPage(evaluateResult) {
  return {
    goto: vi.fn(),
    waitForSelector: vi.fn(),
    evaluate: vi.fn()
      .mockResolvedValueOnce(evaluateResult.handlers ?? []) // enumeration pass
      .mockResolvedValue(evaluateResult),                   // run pass (+ coverage)
    exposeFunction: vi.fn(),
  };
}
```

**(c)** In the test `"should print a protocolTimeout hint when the run aborts on timeout"`, the rejected evaluate now hits the enumeration call first — the flow still reaches the same catch, and the assertion (`errors.some((e) => e.includes('protocolTimeout'))`) still holds. No change needed beyond the helper. Verify it still passes in Step 4.

**(d)** In `"preserves responseHeaders through the __twdCollectMock spread"`, the custom `page.evaluate` mock must serve the enumeration call first. Change the `evaluate` implementation to:

```js
      evaluate: vi.fn()
        .mockResolvedValueOnce(handlers) // enumeration pass
        // Drive the registered __twdCollectMock callback from inside page.evaluate,
        // mirroring how a real browser test would trigger it.
        .mockImplementation(async () => {
          const exposed = page.exposeFunction.mock.calls.find(
            (c) => c[0] === '__twdCollectMock'
          );
          expect(exposed).toBeDefined();
          const collectMock = exposed[1];
          await collectMock({
            alias: 'getPhoto',
            url: '/v1/photo',
            method: 'GET',
            status: 200,
            response: 'bin',
            testId: 't-1',
            responseHeaders: { 'Content-Type': 'image/png' },
          });
          return { handlers, testStatus };
        }),
```

**(e)** The four tests that assert on the run-evaluate arguments keep working unchanged (`toHaveBeenCalledWith` matches any call), but the two filter tests and `"skips coverage collection when a filter is active"` assert `page.evaluate` **call counts and positions** — these stay valid because filtered runs already used an enumeration-then-run sequence, which is unchanged. Leave them as-is.

**(f)** Replace the two retry-summary tests with block-format assertions:

```js
  it("should include retried tests in the run-complete block", async () => {
    const testStatus = [
      { id: '1', status: 'pass', retryAttempt: 2 },
      { id: '2', status: 'pass' },
    ];
    const handlers = [
      { id: '1', name: 'flaky test', type: 'test' },
      { id: '2', name: 'stable test', type: 'test' },
    ];
    const page = createMockPage({ handlers, testStatus });
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runTests();

    const logs = consoleSpy.mock.calls.map(c => String(c[0]));
    const block = logs.find(l => l.startsWith('--- Run complete ---'));
    expect(block).toBeDefined();
    expect(block).toContain('Retried (1):');
    expect(block).toContain('✓ flaky test (passed on attempt 2)');
  });

  it("should not include a retried section when no tests were retried", async () => {
    const testStatus = [{ id: '1', status: 'pass' }];
    const handlers = [{ id: '1', name: 'test1', type: 'test' }];
    const page = createMockPage({ handlers, testStatus });
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runTests();

    const logs = consoleSpy.mock.calls.map(c => String(c[0]));
    const block = logs.find(l => l.startsWith('--- Run complete ---'));
    expect(block).toBeDefined();
    expect(block).not.toContain('Retried');
  });
```

**(g)** Replace the final test (`"should print the Tests: summary line and Failed tests block"`) with:

```js
  it("prints the run-complete block last, with failure paths and errors", async () => {
    const testStatus = [
      { id: '1', status: 'pass' },
      { id: '2', status: 'fail', error: 'boom (at http://localhost:5173/form)' },
      { id: '3', status: 'skip' },
    ];
    const handlers = [
      { id: 's1', name: 'Form', type: 'suite' },
      { id: '1', name: 'should render', parent: 's1', type: 'test' },
      { id: '2', name: 'should submit form', parent: 's1', type: 'test' },
      { id: '3', name: 'should show error', parent: 's1', type: 'test' },
    ];
    const page = createMockPage({ handlers, testStatus });
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runTests();

    const logs = consoleSpy.mock.calls.map((c) => String(c[0]));
    const block = logs[logs.length - 1];
    expect(block.startsWith('--- Run complete ---')).toBe(true);
    expect(block).toContain('Passed: 1 | Failed: 1 | Skipped: 1');
    expect(block).toContain('× Form > should submit form');
    expect(block).toContain('boom (at http://localhost:5173/form)');
  });

  it("prints no config dump and no per-test tree chatter", async () => {
    const testStatus = [{ id: '1', status: 'pass' }];
    const handlers = [{ id: '1', name: 'test1', type: 'test' }];
    const page = createMockPage({ handlers, testStatus });
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runTests();

    const logs = consoleSpy.mock.calls.map((c) => String(c[0]));
    expect(logs.some((l) => l.startsWith('Configuration:'))).toBe(false);
    expect(logs.some((l) => l.startsWith('Starting TWD test runner'))).toBe(false);
    expect(logs.some((l) => l.startsWith('Tests to report'))).toBe(false);
    expect(logs.some((l) => l.startsWith('Browser closed'))).toBe(false);
    expect(logs.some((l) => l === 'Running 1 test(s)...')).toBe(true);
  });

  it("marks rethrown errors as reported", async () => {
    const page = createMockPage({ handlers: [], testStatus: [] });
    const bootError = new Error('net::ERR_CONNECTION_REFUSED at http://localhost:5173');
    page.goto = vi.fn().mockRejectedValue(bootError);
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(runTests()).rejects.toThrow('ERR_CONNECTION_REFUSED');

    expect(bootError.reported).toBe(true);
    const errors = errorSpy.mock.calls.map((c) => String(c[0]));
    expect(errors.some((e) => e.includes('Is your dev server running?'))).toBe(true);
    errorSpy.mockRestore();
  });
```

- [ ] **Step 2: Run the tests to verify the new/changed ones fail**

Run: `npx vitest run tests/runTests.test.js`
Expected: FAIL — the whole file errors because `src/index.js` still imports `formatTestSummary`/`formatFailedTestsBlock`, which no longer exist after Task 1. (That import error IS the red state for this task.)

- [ ] **Step 3: Rewrite `src/index.js`**

Replace the entire contents of `src/index.js` with:

```js
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import { loadConfig } from './config.js';
import { loadContracts, validateMocks } from './contracts.js';
import { printContractReport } from './contractReport.js';
import { generateContractMarkdown } from './contractMarkdown.js';
import { buildTestPath } from './buildTestPath.js';
import { formatRunComplete } from './testSummary.js';
import { selectTestIds } from './filterTests.js';
import { explainError } from './diagnostics.js';

export async function runTests(options = {}) {
  const { testFilters = [] } = options;
  let browser;
  let config;
  try {
    config = loadConfig();
    const workingDir = process.cwd();

    // Load contract validators if configured
    let contractValidators = [];
    if (config.contracts && config.contracts.length > 0) {
      contractValidators = await loadContracts(config.contracts, workingDir);
    }

    browser = await puppeteer.launch({
      headless: config.headless,
      args: config.puppeteerArgs,
      protocolTimeout: config.protocolTimeout,
    });

    const page = await browser.newPage();

    // Register mock collector for contract validation
    const collectedMocks = new Map();
    const occurrenceCounters = new Map();
    if (config.contracts && config.contracts.length > 0) {
      await page.exposeFunction('__twdCollectMock', (mock) => {
        const occKey = `${mock.alias}:${mock.testId}`;
        const count = (occurrenceCounters.get(occKey) || 0) + 1;
        occurrenceCounters.set(occKey, count);

        const dedupKey = `${mock.method}:${mock.url}:${mock.status}:${mock.testId}:${count}`;
        collectedMocks.set(dedupKey, { ...mock, occurrence: count });
      });
    }

    // Navigate to your development server
    const startedAt = Date.now();
    console.log(`Navigating to ${config.url} ...`);
    await page.goto(config.url);

    // Wait for the selector to be available
    await page.waitForSelector('#twd-sidebar-root', { timeout: config.timeout });

    // Enumerate registered handlers (for the count line and --test filtering)
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

    // Resolve --test filters to a concrete set of test ids (null = run all)
    let selectedIds = null;
    if (testFilters.length > 0) {
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
          `Warning: these filter(s) matched no tests (others did): ${unmatchedFilters.map((f) => `"${f}"`).join(', ')}`
        );
      }

      selectedIds = ids;
      console.log(`Filtering: running ${ids.length} test(s) matching --test filter(s).`);
    } else {
      const testCount = registeredHandlers.filter((h) => h.type !== 'suite').length;
      console.log(`Running ${testCount} test(s)...`);
    }

    // Execute all tests
    const { handlers, testStatus } = await page.evaluate(async (retryCount, selectedIds) => {
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
      const handlers = selectedIds
        ? await runner.runByIds(selectedIds)
        : await runner.runAll();
      return { handlers: Array.from(handlers.values()), testStatus };
    }, config.retryCount, selectedIds);

    const durationMs = Date.now() - startedAt;

    // Exit with appropriate code
    let hasFailures = testStatus.some(test => test.status === 'fail');

    // Enrich collected mocks with full test path names
    for (const [, mock] of collectedMocks) {
      if (mock.testId) {
        mock.testName = buildTestPath(mock.testId, handlers);
      }
    }

    // Contract validation
    if (config.contracts && config.contracts.length > 0) {
      if (collectedMocks.size === 0) {
        console.log('\nNo mocks collected — ensure twd-js supports contract collection');
      }
      const validationOutput = validateMocks(collectedMocks, contractValidators);
      const hasContractErrors = printContractReport(validationOutput);
      if (hasContractErrors) {
        hasFailures = true;
      }

      // Write markdown report for CI/PR integration
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

    // Handle code coverage if enabled (skipped when a --test filter is active)
    if (selectedIds && config.coverage) {
      console.log('Skipping coverage collection (test filter active).');
    }
    if (config.coverage && !hasFailures && !selectedIds) {
      const coverage = await page.evaluate(() => window.__coverage__);
      if (coverage) {
        const coverageDir = path.resolve(workingDir, config.coverageDir);
        const nycDir = path.resolve(workingDir, config.nycOutputDir);

        if (!fs.existsSync(nycDir)) {
          fs.mkdirSync(nycDir, { recursive: true });
        }
        if (!fs.existsSync(coverageDir)) {
          fs.mkdirSync(coverageDir, { recursive: true });
        }

        const coveragePath = path.join(nycDir, 'out.json');
        fs.writeFileSync(coveragePath, JSON.stringify(coverage));
        console.log(`Code coverage data written to ${coveragePath}`);
      } else {
        console.log('No code coverage data found.');
      }
    }

    await browser.close();

    // The run-complete block is always the last output of a completed run
    console.log('');
    console.log(formatRunComplete({ testStatus, handlers, durationMs }));

    return hasFailures;

  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.error(`Error running tests: ${message}`);
    const diagnostic = explainError(error, config);
    if (diagnostic) {
      console.error(`\n${diagnostic}`);
    } else if (error && error.stack) {
      console.error(`\n${error.stack}`);
    }
    if (error && typeof error === 'object') {
      error.reported = true;
    }
    if (browser) await browser.close();
    throw error;
  }
}
```

Deliberate changes from the old version (everything else is verbatim):
- Removed: `Starting TWD test runner...`, the `Configuration:` JSON dump, `Page loaded. Starting tests...`, `Tests to report: N`, `Browser closed.`, `Collecting code coverage data...`, the `reportResults` import+call, the old `⟳ Retried tests:` block, the old summary/failed-block printing, and the local `isProtocolTimeout`.
- Added: always-on handler enumeration (the filter path previously did this conditionally — same evaluate body), the `Running N test(s)...` line for unfiltered runs, `formatRunComplete` as the final output, `explainError` + `error.reported` in the catch.
- `config` is declared outside `try` so the catch can pass it to `explainError`.

- [ ] **Step 4: Run the run-flow tests to verify they pass**

Run: `npx vitest run tests/runTests.test.js`
Expected: PASS (all tests, including the updated ones).

- [ ] **Step 5: Fix the silent bin catch**

In `bin/twd-cli.js`, replace:

```js
  } catch (error) {
    process.exit(1);
  }
```

with:

```js
  } catch (error) {
    if (!error?.reported) {
      console.error(error?.message ?? String(error));
    }
    process.exit(1);
  }
```

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: PASS — every test file green (the Task 1 note about the broken full suite is now resolved).

- [ ] **Step 7: Commit**

```bash
git add src/index.js bin/twd-cli.js tests/runTests.test.js
git commit -m "feat: relay-style run output, actionable error diagnostics, no silent exits"
```

---

### Task 4: Remove the `twd-js` dependency

`src/index.js` no longer imports `reportResults` — the package's only `twd-js` import. The in-browser `__testRunner` comes from the *user's app* bundling twd-js, not from this dependency.

**Files:**
- Modify: `package.json` (remove dependency)
- Modify: `package-lock.json` (regenerated)

**Interfaces:**
- Consumes: Task 3 (the import must already be gone).
- Produces: nothing for later tasks.

- [ ] **Step 1: Verify nothing imports twd-js anymore**

Run: `grep -rn "from 'twd-js" src/ bin/ tests/`
Expected: no output. (If anything matches, stop — Task 3 was not completed.)

- [ ] **Step 2: Remove the dependency**

In `package.json`, delete this line from `dependencies`:

```json
    "twd-js": "^1.8.2"
```

(leaving `openapi-mock-validator` and `puppeteer`).

- [ ] **Step 3: Regenerate the lockfile — macOS pass, then Linux pass**

```bash
npm install
npm run lock:linux
```

The second command is **required** (repo rule): npm on macOS leaves `@emnapi/*` transitive deps stale in the lock, which breaks `npm ci` on Linux CI. Docker must be running; if it is not, start Docker Desktop first. Verify the lockfile no longer contains a top-level `node_modules/twd-js` entry: `grep -c '"node_modules/twd-js"' package-lock.json` → expected `0`.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: drop twd-js dependency (reportResults no longer used)"
```

---

### Task 5: Update docs and verify end-to-end

**Files:**
- Modify: `CLAUDE.md:29-46` (architecture steps 5-6 + Key Dependencies)
- Manual verification against `test-example-app/`

**Interfaces:**
- Consumes: Tasks 1-4 complete.
- Produces: nothing — final task.

- [ ] **Step 1: Update CLAUDE.md**

In `CLAUDE.md`, replace the `runTests()` step list items 5-6:

```
5. Calls `window.__testRunner` in the browser context to execute all tests
6. Reports results via `reportResults()` from `twd-js/runner-ci`
```

with:

```
5. Calls `window.__testRunner` in the browser context to execute all tests
6. Prints a relay-style summary block (`formatRunComplete` in `src/testSummary.js`) as the last output: passed/failed/skipped counts, duration, failed tests with `suite > test` paths and error messages, and retried tests. Known infrastructure errors (dev server down, sidebar missing, protocol timeout, Chrome launch failure) get actionable diagnostics from `src/diagnostics.js`.
```

And replace the Key Dependencies bullet:

```
- **twd-js** — The TWD testing framework; provides `reportResults` from `twd-js/runner-ci` and the in-browser `__testRunner`
```

with:

```
- **twd-js** — not a dependency of this package; the user's app bundles it, which provides the in-browser `__testRunner` and `#twd-sidebar-root` this CLI drives
```

- [ ] **Step 2: Manual verification — green run**

```bash
cd test-example-app && npm install && npm run dev &
sleep 5
cd test-example-app && node ../bin/twd-cli.js run
```

Expected: `Navigating to http://localhost:5173 ...`, `Running N test(s)...`, contract report lines, then the `--- Run complete ---` block **last** with `Failed: 0`; exit code 0 (`echo $?`).

- [ ] **Step 3: Manual verification — failing test**

Temporarily break an assertion in one of `test-example-app/src/**` TWD test files (e.g. change an expected text), re-run `node ../bin/twd-cli.js run` from `test-example-app/`.
Expected: block shows `Failed: 1` and a `Failed tests (1):` entry with `× <suite> > <test>` plus the indented error message ending in `(at http://localhost:5173/...)`; exit code 1. **Revert the break afterwards.**

- [ ] **Step 4: Manual verification — dev server down**

Stop the dev server (`kill %1` or Ctrl-C the background job), then from `test-example-app/` run `node ../bin/twd-cli.js run`.
Expected output includes:

```
Error running tests: net::ERR_CONNECTION_REFUSED at http://localhost:5173

Could not reach http://localhost:5173 (ERR_CONNECTION_REFUSED).
Is your dev server running? Start it (e.g. `npm run dev`) or fix "url" in twd.config.json.
```

with no stack trace, exit code 1, and no duplicate message from the bin catch.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: describe relay-style output and diagnostics in CLAUDE.md"
```
