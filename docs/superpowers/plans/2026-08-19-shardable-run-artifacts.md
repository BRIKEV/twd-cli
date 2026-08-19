# Shardable Run Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a twd-cli run be split across parallel CI jobs with `--shard i/n`, each writing a machine-readable report plus raw coverage, and add `twd-cli merge <dir>` to join them into one report covering tests, coverage, and contract validation.

**Architecture:** Each shard boots its own browser, enumerates the whole suite as runs already do, and keeps every Nth test id (round-robin). It writes `run.json` + `coverage.json` to a report dir that CI uploads as an artifact. `merge` reads the downloaded shard dirs, validates they agree, concatenates them into a report of the **same shape**, and owns the exit code. Merged-equals-single shape makes merge associative and lets existing formatters render both.

**Tech Stack:** Node ESM, vitest, Puppeteer (already present), `istanbul-lib-coverage` (new runtime dependency).

**Spec:** `docs/superpowers/specs/2026-08-19-shardable-run-artifacts-design.md`

## Global Constraints

- **Strictly additive.** A run without `--shard` must behave exactly as 1.4.0 does: same console output, same files written, same exit code. Every behavior change is gated on `sharded` being true.
- Work happens on branch `feat/shardable-run-artifacts` (already checked out). Never commit to `main`.
- ESM only. `import`, no `require`.
- No test may require a real browser or a real ffmpeg binary. `node:child_process` and `page.screencast` stay mocked.
- `vi.mock('fs')` auto-mocks `fs.statSync` to return `undefined`. Anything reading a `Stats` must tolerate that.
- One `src/` module per responsibility, one `tests/<name>.test.js` per module — the existing repo convention.
- After any dependency change run `npm run lock:linux` (Docker must be running). macOS npm never installs the wasm32-wasi optional packages, so it leaves their `@emnapi/*` transitive deps stale in the lock and `npm ci` breaks on Linux CI.
- Report schema version is `1`. Default report dir is `./.twd/run`. Default merged output is `./.twd/merged-run.json`.
- Final version is `1.5.0-beta.0`, published under the `beta` dist-tag.

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `src/shard.js` | Parse `<index>/<total>`; round-robin id slicing |
| `src/runReport.js` | Build the report object; fingerprint the discovered test list. Pure, no I/O |
| `src/reportFiles.js` | Write a shard's report + coverage; discover and read shard dirs |
| `src/mergeCoverage.js` | Merge Istanbul coverage objects |
| `src/mergeReports.js` | Associative structural merge + consistency validation + derived totals |
| `src/mergeCommand.js` | Orchestrate `merge`: read, merge, write, render, decide exit code |
| `tests/shard.test.js`, `tests/runReport.test.js`, `tests/reportFiles.test.js`, `tests/mergeCoverage.test.js`, `tests/mergeReports.test.js`, `tests/mergeCommand.test.js` | One per module |

**Modify:**

| File | Change |
|---|---|
| `src/parseArgs.js` | `--shard`, `--report-dir`; new `parseMergeArgs` |
| `src/index.js` | Slice ids; build and write the report; gate the two behavior changes on `sharded` |
| `src/testSummary.js` | Optional `shards` / `computeMs` params for the merged breakdown |
| `bin/twd-cli.js` | `merge` subcommand + help text |
| `tests/parseArgs.test.js` | 8 full-object assertions gain the new keys |
| `tests/runTests.test.js` | Shard slicing, report writing, and the two non-regression assertions |
| `tests/testSummary.test.js` | Breakdown line rendering |
| `package.json` | `istanbul-lib-coverage` dependency; version `1.5.0-beta.0` |
| `.github/workflows/e2e.yml` | A 2-shard + merge job |
| `README.md`, `CHANGELOG.md` | Document the flags and the command |

**Why `mergeCommand.js` is separate from `mergeReports.js`:** `mergeReports` must stay pure and associative to be property-testable. Completeness checking (is `1..total` fully covered?) cannot live there, because a partial merge of 2 of 3 shards is a legal intermediate value — enforcing completeness inside the merge would make `merge(merge(a,b),c)` throw. So `mergeReports` validates *consistency* (things preserved under partial merge) and `mergeCommand` enforces *completeness*.

---

### Task 1: Shard spec parsing and id slicing

**Files:**
- Create: `src/shard.js`
- Test: `tests/shard.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseShardSpec(value) -> { index: number, total: number }` (throws `Error` on invalid input); `selectShardIds(ids: string[], index: number, total: number) -> string[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/shard.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { parseShardSpec, selectShardIds } from '../src/shard.js';

describe('parseShardSpec', () => {
  it('parses <index>/<total>', () => {
    expect(parseShardSpec('2/4')).toEqual({ index: 2, total: 4 });
    expect(parseShardSpec('1/1')).toEqual({ index: 1, total: 1 });
    expect(parseShardSpec(' 3/4 ')).toEqual({ index: 3, total: 4 });
  });

  // Unlike --record-speed, a bad --shard must never be silently ignored: it
  // would run zero tests and exit 0, reading as a green build that tested
  // nothing.
  it('throws when the index exceeds the total', () => {
    expect(() => parseShardSpec('5/4')).toThrow(/between 1 and 4/);
  });

  it('throws on a zero or negative index', () => {
    expect(() => parseShardSpec('0/4')).toThrow(/between 1 and 4/);
    expect(() => parseShardSpec('-1/4')).toThrow(/Expected <index>\/<total>/);
  });

  it('throws on a zero total', () => {
    expect(() => parseShardSpec('2/0')).toThrow(/at least 1/);
  });

  it('throws on unparseable input', () => {
    for (const bad of ['abc', '', '2', '2/', '/4', '2.5/4', '2/4/6', undefined, null]) {
      expect(() => parseShardSpec(bad)).toThrow(/Expected <index>\/<total>/);
    }
  });

  it('names the offending value in the message', () => {
    expect(() => parseShardSpec('9/2')).toThrow(/"9\/2"/);
  });
});

describe('selectShardIds', () => {
  const ids = Array.from({ length: 12 }, (_, i) => `t${i}`);

  it('takes every Nth id at its own offset', () => {
    expect(selectShardIds(ids, 1, 4)).toEqual(['t0', 't4', 't8']);
    expect(selectShardIds(ids, 2, 4)).toEqual(['t1', 't5', 't9']);
    expect(selectShardIds(ids, 4, 4)).toEqual(['t3', 't7', 't11']);
  });

  it('returns everything when total is 1', () => {
    expect(selectShardIds(ids, 1, 1)).toEqual(ids);
  });

  // 3 tests across 4 shards leaves the fourth with nothing. Legal, not an error.
  it('returns an empty slice when there are fewer ids than shards', () => {
    expect(selectShardIds(['a', 'b', 'c'], 4, 4)).toEqual([]);
    expect(selectShardIds([], 1, 4)).toEqual([]);
  });

  // The property that makes sharding trustworthy: nothing lost, nothing doubled.
  it('partitions the input — every id lands in exactly one shard', () => {
    const many = Array.from({ length: 37 }, (_, i) => `t${i}`);
    const total = 5;
    const slices = Array.from({ length: total }, (_, i) => selectShardIds(many, i + 1, total));
    const counts = new Map();
    for (const id of slices.flat()) counts.set(id, (counts.get(id) ?? 0) + 1);
    expect(counts.size).toBe(many.length);
    expect([...counts.values()]).toEqual(many.map(() => 1));
  });

  it('does not mutate its input', () => {
    const input = ['a', 'b', 'c'];
    selectShardIds(input, 1, 2);
    expect(input).toEqual(['a', 'b', 'c']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest --run tests/shard.test.js`
Expected: FAIL — `Failed to load ../src/shard.js`.

- [ ] **Step 3: Write the implementation**

Create `src/shard.js`:

```js
// Parses a "<index>/<total>" shard spec, e.g. "2/4" for job 2 of 4.
//
// This throws where src/parseArgs.js silently ignores a malformed
// --record-speed, and the divergence is deliberate: "--shard 5/4" would select
// no tests and exit 0, which reads as a green build that tested nothing.
export function parseShardSpec(value) {
  const raw = typeof value === 'string' ? value.trim() : value;
  const match = /^(\d+)\/(\d+)$/.exec(String(raw ?? ''));
  if (!match) {
    throw new Error(
      `Invalid --shard "${value}". Expected <index>/<total>, e.g. --shard 2/4.`
    );
  }

  const index = Number(match[1]);
  const total = Number(match[2]);

  if (total < 1) {
    throw new Error(`Invalid --shard "${value}". Total must be at least 1.`);
  }
  if (index < 1 || index > total) {
    throw new Error(
      `Invalid --shard "${value}". Index must be between 1 and ${total}.`
    );
  }

  return { index, total };
}

// Round-robin slice of an ordered id list. `index` is 1-based.
//
// Round-robin rather than contiguous: it balances better when adjacent tests
// have similar cost, and nothing in twd-js requires a suite to run
// contiguously, so locality buys nothing. An empty result is a legal outcome —
// 3 tests across 4 shards leaves the fourth with nothing to run.
export function selectShardIds(ids, index, total) {
  return ids.filter((_, i) => i % total === index - 1);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest --run tests/shard.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shard.js tests/shard.test.js
git commit -m "feat(shard): parse shard specs and slice test ids round-robin"
```

---

### Task 2: `--shard` and `--report-dir` flags, plus `parseMergeArgs`

**Files:**
- Modify: `src/parseArgs.js`
- Modify: `tests/parseArgs.test.js` (8 existing assertions at lines 6, 10, 17, 24, 31, 35, 71, 93)
- Test: `tests/parseArgs.test.js`

**Interfaces:**
- Consumes: `parseShardSpec` from `src/shard.js` (Task 1).
- Produces: `parseRunArgs(argv) -> { testFilters: string[], record: object, shard: {index,total}|null, reportDir: string|null }`; `parseMergeArgs(argv) -> { dir: string|null, out: string|null }`.

`parseRunArgs` now always returns `shard` and `reportDir`, defaulting to `null`. That is why the 8 existing full-object assertions must be updated — they use `toEqual` on the whole return value.

- [ ] **Step 1: Update the 8 existing assertions**

In `tests/parseArgs.test.js`, add `shard: null, reportDir: null` to every full-object `toEqual`. The two single-line ones become:

```js
// line 6
expect(parseRunArgs([])).toEqual({ testFilters: [], record: {}, shard: null, reportDir: null });
// line 31
expect(parseRunArgs(['--test'])).toEqual({ testFilters: [], record: {}, shard: null, reportDir: null });
```

The six multi-line ones (lines 10, 17, 24, 35, 71, 93) each gain two properties, e.g.:

```js
expect(parseRunArgs(['--test', 'shows error'])).toEqual({
  testFilters: ['shows error'],
  record: {},
  shard: null,
  reportDir: null,
});
```

- [ ] **Step 2: Write the failing tests for the new flags**

Append to `tests/parseArgs.test.js`:

```js
describe('parseRunArgs shard and report flags', () => {
  it('parses --shard in both forms', () => {
    expect(parseRunArgs(['--shard', '2/4']).shard).toEqual({ index: 2, total: 4 });
    expect(parseRunArgs(['--shard=3/4']).shard).toEqual({ index: 3, total: 4 });
  });

  it('throws on an invalid --shard instead of ignoring it', () => {
    expect(() => parseRunArgs(['--shard', '5/4'])).toThrow(/Invalid --shard/);
    expect(() => parseRunArgs(['--shard=abc'])).toThrow(/Invalid --shard/);
  });

  it('throws on a trailing --shard with no value', () => {
    expect(() => parseRunArgs(['--shard'])).toThrow(/Invalid --shard/);
  });

  it('parses --report-dir in both forms', () => {
    expect(parseRunArgs(['--report-dir', './out']).reportDir).toBe('./out');
    expect(parseRunArgs(['--report-dir=./out']).reportDir).toBe('./out');
  });

  it('ignores a trailing --report-dir with no value', () => {
    expect(parseRunArgs(['--report-dir']).reportDir).toBeNull();
  });

  it('combines --shard with --test filters and record flags', () => {
    expect(parseRunArgs(['--shard', '2/4', '--test', 'Login', '--record'])).toEqual({
      testFilters: ['Login'],
      record: { enabled: true },
      shard: { index: 2, total: 4 },
      reportDir: null,
    });
  });
});

describe('parseMergeArgs', () => {
  it('reads the directory as the first positional', () => {
    expect(parseMergeArgs(['.twd/shards'])).toEqual({ dir: '.twd/shards', out: null });
  });

  it('parses --out in both forms', () => {
    expect(parseMergeArgs(['.twd/shards', '--out', 'merged.json']))
      .toEqual({ dir: '.twd/shards', out: 'merged.json' });
    expect(parseMergeArgs(['.twd/shards', '--out=merged.json']))
      .toEqual({ dir: '.twd/shards', out: 'merged.json' });
  });

  it('returns a null dir when none is given', () => {
    expect(parseMergeArgs([])).toEqual({ dir: null, out: null });
    expect(parseMergeArgs(['--out=merged.json'])).toEqual({ dir: null, out: 'merged.json' });
  });

  it('takes only the first positional as the directory', () => {
    expect(parseMergeArgs(['a', 'b']).dir).toBe('a');
  });
});
```

Update the import at the top of the file:

```js
import { parseRunArgs, parseMergeArgs } from "../src/parseArgs.js";
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest --run tests/parseArgs.test.js`
Expected: FAIL — `parseMergeArgs is not a function`, and the new shard assertions fail on `undefined`.

- [ ] **Step 4: Implement the flags**

In `src/parseArgs.js`, add the import at the top:

```js
import { parseShardSpec } from './shard.js';
```

Inside `parseRunArgs`, add two declarations next to the existing ones:

```js
export function parseRunArgs(argv) {
  const testFilters = [];
  const record = {};
  let shard = null;
  let reportDir = null;
```

Add two branches to the token loop, after the `--test` branch:

```js
    } else if (token === '--shard' || token.startsWith('--shard=')) {
      const { value, consumed } = readValue(token, '--shard', i);
      // Throws on a malformed spec. A silently-ignored --shard would run zero
      // tests and exit 0.
      shard = parseShardSpec(value);
      i += consumed - 1;
    } else if (token === '--report-dir' || token.startsWith('--report-dir=')) {
      const { value, consumed } = readValue(token, '--report-dir', i);
      if (value !== undefined) reportDir = value;
      i += consumed - 1;
```

Change the return statement:

```js
  return { testFilters, record, shard, reportDir };
}
```

Append `parseMergeArgs` to the same file:

```js
// `twd-cli merge <dir> [--out <path>]`. The directory is the first positional
// token; anything after the first is ignored.
export function parseMergeArgs(argv) {
  let dir = null;
  let out = null;

  const readValue = (token, prefix, index) => {
    if (token === prefix) {
      return { value: argv[index + 1], consumed: argv[index + 1] !== undefined ? 2 : 1 };
    }
    return { value: token.slice(prefix.length + 1), consumed: 1 };
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (token === '--out' || token.startsWith('--out=')) {
      const { value, consumed } = readValue(token, '--out', i);
      if (value !== undefined) out = value;
      i += consumed - 1;
    } else if (!token.startsWith('--') && dir === null) {
      dir = token;
    }
  }

  return { dir, out };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest --run tests/parseArgs.test.js`
Expected: PASS — the 17 original tests plus 10 new ones.

- [ ] **Step 6: Commit**

```bash
git add src/parseArgs.js tests/parseArgs.test.js
git commit -m "feat(cli): add --shard, --report-dir, and merge arg parsing"
```

---

### Task 3: Build the run report and fingerprint discovery

**Files:**
- Create: `src/runReport.js`
- Test: `tests/runReport.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `REPORT_SCHEMA_VERSION` (number, `1`); `fingerprintTests(orderedIds: string[], filters: string[]) -> string`; `buildRunReport(options) -> report`. `buildRunReport` takes `{ shard, startedAt, endedAt, allTestIds, filters, handlers, tests, executed, notRun, stoppedEarly, coverageFile, recording, contracts }` where `startedAt`/`endedAt` are epoch milliseconds and `shard` is `{index,total}`.

- [ ] **Step 1: Write the failing test**

Create `tests/runReport.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildRunReport, fingerprintTests, REPORT_SCHEMA_VERSION } from '../src/runReport.js';

const handlers = [
  { id: 's1', name: 'Login', parent: null, type: 'suite' },
  { id: 't1', name: 'works', parent: 's1', type: 'test' },
];

function build(overrides = {}) {
  return buildRunReport({
    shard: { index: 2, total: 4 },
    startedAt: 1_000,
    endedAt: 4_500,
    allTestIds: ['t1', 't2', 't3'],
    filters: [],
    handlers,
    tests: [{ id: 't1', status: 'pass' }],
    executed: 1,
    notRun: 0,
    stoppedEarly: false,
    ...overrides,
  });
}

describe('fingerprintTests', () => {
  it('is stable for the same input', () => {
    expect(fingerprintTests(['a', 'b'])).toBe(fingerprintTests(['a', 'b']));
  });

  it('is prefixed with the algorithm', () => {
    expect(fingerprintTests(['a'])).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  // Order matters: round-robin slicing is only correct if every shard sees the
  // same list in the same order.
  it('changes when the id order changes', () => {
    expect(fingerprintTests(['a', 'b'])).not.toBe(fingerprintTests(['b', 'a']));
  });

  it('changes when the id set changes', () => {
    expect(fingerprintTests(['a', 'b'])).not.toBe(fingerprintTests(['a', 'b', 'c']));
  });

  it('changes when the filters differ', () => {
    expect(fingerprintTests(['a'], ['Login'])).not.toBe(fingerprintTests(['a'], ['Cart']));
    expect(fingerprintTests(['a'], [])).not.toBe(fingerprintTests(['a'], ['Login']));
  });

  // Filters are OR'd, so their order is not meaningful and must not split
  // otherwise-identical shards.
  it('ignores the order the filters were given in', () => {
    expect(fingerprintTests(['a'], ['Login', 'Cart']))
      .toBe(fingerprintTests(['a'], ['Cart', 'Login']));
  });
});

describe('buildRunReport', () => {
  it('stamps the schema version', () => {
    expect(build().schemaVersion).toBe(REPORT_SCHEMA_VERSION);
  });

  it('wraps a single shard descriptor in an array', () => {
    const report = build();
    expect(report.shards).toHaveLength(1);
    expect(report.shards[0]).toMatchObject({
      index: 2, total: 4, executed: 1, notRun: 0, failed: 0, stoppedEarly: false,
    });
  });

  it('derives durationMs and ISO timestamps from epoch millis', () => {
    const shard = build().shards[0];
    expect(shard.durationMs).toBe(3500);
    expect(shard.startedAt).toBe(new Date(1_000).toISOString());
    expect(shard.endedAt).toBe(new Date(4_500).toISOString());
  });

  it('counts this shard\'s failures', () => {
    const report = build({
      tests: [
        { id: 't1', status: 'pass' },
        { id: 't2', status: 'fail', error: 'boom' },
        { id: 't3', status: 'skip' },
      ],
    });
    expect(report.shards[0].failed).toBe(1);
  });

  it('records total discovered tests and the fingerprint', () => {
    const report = build();
    expect(report.discovery.totalTests).toBe(3);
    expect(report.discovery.fingerprint).toBe(fingerprintTests(['t1', 't2', 't3'], []));
  });

  it('carries handlers and tests through untouched', () => {
    const report = build();
    expect(report.handlers).toEqual(handlers);
    expect(report.tests).toEqual([{ id: 't1', status: 'pass' }]);
  });

  it('copies the filters rather than aliasing them', () => {
    const filters = ['Login'];
    const report = build({ filters });
    filters.push('Cart');
    expect(report.selection.filters).toEqual(['Login']);
  });

  it('defaults contracts to an unconfigured empty block', () => {
    expect(build().contracts).toEqual({
      configured: false, partial: false, results: [], skipped: [],
    });
  });

  it('passes a contracts block through when given', () => {
    const contracts = { configured: true, partial: true, results: [{ alias: 'a' }], skipped: [] };
    expect(build({ contracts }).contracts).toEqual(contracts);
  });

  it('defaults coverageFile and recording to null', () => {
    const shard = build().shards[0];
    expect(shard.coverageFile).toBeNull();
    expect(shard.recording).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest --run tests/runReport.test.js`
Expected: FAIL — `Failed to load ../src/runReport.js`.

- [ ] **Step 3: Write the implementation**

Create `src/runReport.js`:

```js
import crypto from 'node:crypto';

export const REPORT_SCHEMA_VERSION = 1;

/**
 * Hash of the full ordered test id list plus any active --test filters.
 *
 * Round-robin sharding is correct only if every job enumerates an identical
 * test set in an identical order. That breaks silently if the app registers
 * tests conditionally — a feature flag, a date, Math.random — or if two shard
 * jobs did not build the same code: tests quietly never run and the build stays
 * green. Shards compare fingerprints at merge time so it becomes an error.
 *
 * Filters are OR'd, so their order carries no meaning and is normalized away.
 */
export function fingerprintTests(orderedIds, filters = []) {
  const payload = JSON.stringify({
    orderedIds,
    filters: [...filters].sort(),
  });
  const digest = crypto.createHash('sha256').update(payload).digest('hex');
  return `sha256:${digest}`;
}

/**
 * Assembles the on-disk run report. Pure: no I/O, no clock reads.
 *
 * `shards` is an array even for a single run, because a merged report has the
 * same shape as a single-shard one. That is what makes merging associative and
 * lets one set of formatters render both.
 *
 * `startedAt` and `endedAt` are epoch milliseconds; the report stores ISO
 * strings plus the derived duration.
 */
export function buildRunReport({
  shard,
  startedAt,
  endedAt,
  allTestIds,
  filters = [],
  handlers,
  tests,
  executed,
  notRun,
  stoppedEarly,
  coverageFile = null,
  recording = null,
  contracts = null,
}) {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    shards: [
      {
        index: shard.index,
        total: shard.total,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date(endedAt).toISOString(),
        durationMs: endedAt - startedAt,
        executed,
        notRun,
        // Merged reports do not record which shard ran a test, so the per-shard
        // breakdown line could not be rendered without this count.
        failed: tests.filter((t) => t.status === 'fail').length,
        stoppedEarly,
        coverageFile,
        recording,
      },
    ],
    discovery: {
      totalTests: allTestIds.length,
      fingerprint: fingerprintTests(allTestIds, filters),
    },
    selection: { filters: [...filters] },
    handlers,
    tests,
    contracts: contracts ?? {
      configured: false,
      partial: false,
      results: [],
      skipped: [],
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest --run tests/runReport.test.js`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add src/runReport.js tests/runReport.test.js
git commit -m "feat(report): build run reports and fingerprint discovered tests"
```

---

### Task 4: Read and write shard report files

**Files:**
- Create: `src/reportFiles.js`
- Test: `tests/reportFiles.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `DEFAULT_REPORT_DIR` (`'./.twd/run'`), `DEFAULT_MERGED_OUT` (`'./.twd/merged-run.json'`), `RUN_REPORT_FILE` (`'run.json'`), `COVERAGE_FILE` (`'coverage.json'`); `writeRunReport(dir, report, coverage) -> { reportPath, coveragePath|null }`; `readShardReports(dir) -> Array<{ dir, report }>`; `readShardCoverage(shardDir, coverageFile) -> object|null`.

- [ ] **Step 1: Write the failing test**

Create `tests/reportFiles.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs');

import fs from 'fs';
import {
  writeRunReport,
  readShardReports,
  readShardCoverage,
  RUN_REPORT_FILE,
  COVERAGE_FILE,
  DEFAULT_REPORT_DIR,
} from '../src/reportFiles.js';

const report = { schemaVersion: 1, tests: [] };

describe('writeRunReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the directory recursively', () => {
    writeRunReport('.twd/run', report, null);
    expect(fs.mkdirSync).toHaveBeenCalledWith('.twd/run', { recursive: true });
  });

  it('writes pretty-printed JSON so the report is readable by eye', () => {
    writeRunReport('.twd/run', report, null);
    const [file, body] = vi.mocked(fs.writeFileSync).mock.calls[0];
    expect(file).toBe(`.twd/run/${RUN_REPORT_FILE}`);
    expect(body).toBe(`${JSON.stringify(report, null, 2)}\n`);
  });

  it('does not write a coverage file when there is no coverage', () => {
    writeRunReport('.twd/run', report, null);
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    expect(writeRunReport('.twd/run', report, null).coveragePath).toBeNull();
  });

  // Coverage stays raw and unformatted: it is machine input for nyc, routinely
  // several megabytes, and pretty-printing it would double the artifact size.
  it('writes coverage compactly alongside the report', () => {
    const coverage = { '/a.js': { s: { 0: 1 } } };
    const result = writeRunReport('.twd/run', report, coverage);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      `.twd/run/${COVERAGE_FILE}`,
      JSON.stringify(coverage),
    );
    expect(result.coveragePath).toBe(`.twd/run/${COVERAGE_FILE}`);
  });
});

describe('readShardReports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // This is download-artifact's layout: one directory per artifact name.
  it('reads run.json from each child directory', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).endsWith(RUN_REPORT_FILE));
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: 'twd-run-1', isDirectory: () => true },
      { name: 'twd-run-2', isDirectory: () => true },
      { name: 'notes.txt', isDirectory: () => false },
    ]);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(report));

    const found = readShardReports('.twd/shards');

    expect(found.map((f) => f.dir)).toEqual([
      '.twd/shards',
      '.twd/shards/twd-run-1',
      '.twd/shards/twd-run-2',
    ]);
    expect(found[0].report).toEqual(report);
  });

  it('skips child directories with no run.json', () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p).includes('twd-run-1'));
    vi.mocked(fs.readdirSync).mockReturnValue([
      { name: 'twd-run-1', isDirectory: () => true },
      { name: 'empty', isDirectory: () => true },
    ]);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(report));

    expect(readShardReports('.twd/shards').map((f) => f.dir))
      .toEqual(['.twd/shards/twd-run-1']);
  });

  it('returns an empty array when the directory does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readdirSync).mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    expect(readShardReports('.twd/nope')).toEqual([]);
  });

  it('explains which file failed to parse', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    vi.mocked(fs.readFileSync).mockReturnValue('{ not json');
    expect(() => readShardReports('.twd/shards')).toThrow(/run\.json/);
  });
});

describe('readShardCoverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the named coverage file from the shard directory', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{"/a.js":{}}');
    expect(readShardCoverage('.twd/shards/twd-run-1', COVERAGE_FILE)).toEqual({ '/a.js': {} });
  });

  it('returns null when the shard recorded no coverage file', () => {
    expect(readShardCoverage('.twd/shards/twd-run-1', null)).toBeNull();
    expect(fs.existsSync).not.toHaveBeenCalled();
  });

  // A shard whose coverage file is absent simply does not contribute; merge
  // reports the contributor count rather than failing.
  it('returns null when the file is missing on disk', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(readShardCoverage('.twd/shards/twd-run-1', COVERAGE_FILE)).toBeNull();
  });
});

describe('defaults', () => {
  it('defaults the report dir to .twd/run', () => {
    expect(DEFAULT_REPORT_DIR).toBe('./.twd/run');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest --run tests/reportFiles.test.js`
Expected: FAIL — `Failed to load ../src/reportFiles.js`.

- [ ] **Step 3: Write the implementation**

Create `src/reportFiles.js`:

```js
import fs from 'fs';
import path from 'path';

export const DEFAULT_REPORT_DIR = './.twd/run';
export const DEFAULT_MERGED_OUT = './.twd/merged-run.json';
export const RUN_REPORT_FILE = 'run.json';
export const COVERAGE_FILE = 'coverage.json';

/**
 * Writes one shard's report, and its coverage when it collected any.
 *
 * The report is pretty-printed because a human reads it when a merge complains.
 * Coverage is not: it is machine input for nyc, routinely several megabytes, and
 * indenting it would roughly double the artifact size for no benefit.
 */
export function writeRunReport(dir, report, coverage = null) {
  fs.mkdirSync(dir, { recursive: true });

  const reportPath = path.join(dir, RUN_REPORT_FILE);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  let coveragePath = null;
  if (coverage) {
    coveragePath = path.join(dir, COVERAGE_FILE);
    fs.writeFileSync(coveragePath, JSON.stringify(coverage));
  }

  return { reportPath, coveragePath };
}

function readJson(file, label) {
  const raw = fs.readFileSync(file, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Could not parse ${label} at ${file}: ${err.message}`);
  }
}

/**
 * Finds every shard report under `dir`.
 *
 * actions/download-artifact lays each artifact out as its own directory, so the
 * normal shape is `<dir>/<artifact-name>/run.json`. A bare `<dir>/run.json` is
 * also accepted, which is what a local single-shard run produces.
 */
export function readShardReports(dir) {
  const found = [];

  const direct = path.join(dir, RUN_REPORT_FILE);
  if (fs.existsSync(direct)) {
    found.push({ dir, report: readJson(direct, RUN_REPORT_FILE) });
  }

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    // Missing or unreadable directory: the caller reports "no reports found",
    // which is a better message than an ENOENT stack.
    return found;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const shardDir = path.join(dir, entry.name);
    const file = path.join(shardDir, RUN_REPORT_FILE);
    if (fs.existsSync(file)) {
      found.push({ dir: shardDir, report: readJson(file, RUN_REPORT_FILE) });
    }
  }

  return found;
}

/**
 * Reads a shard's coverage, or null when it collected none.
 *
 * Absence is a normal outcome, not an error: a filtered run skips coverage
 * entirely. Merge reports how many shards contributed.
 */
export function readShardCoverage(shardDir, coverageFile) {
  if (!coverageFile) return null;
  const file = path.join(shardDir, coverageFile);
  if (!fs.existsSync(file)) return null;
  return readJson(file, COVERAGE_FILE);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest --run tests/reportFiles.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/reportFiles.js tests/reportFiles.test.js
git commit -m "feat(report): read and write shard report artifacts"
```

---

### Task 5: Merge Istanbul coverage objects

**Files:**
- Create: `src/mergeCoverage.js`
- Modify: `package.json` (promote `istanbul-lib-coverage` to a runtime dependency)
- Modify: `package-lock.json` (regenerated)
- Test: `tests/mergeCoverage.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `mergeCoverage(coverageObjects: Array<object|null>) -> object` — an Istanbul coverage map JSON with counts summed across inputs. Nulls are skipped.

`istanbul-lib-coverage@3.2.2` is currently present only transitively via the `@vitest/coverage-v8` devDependency. It must become a real dependency, because `merge` runs in a consumer's project where devDependencies are not installed.

**This test file must not mock `fs`** — it exercises a real library against in-memory objects.

- [ ] **Step 1: Add the dependency**

```bash
npm install istanbul-lib-coverage@^3.2.2 --save
```

Verify it landed under `dependencies` (not `devDependencies`):

```bash
node -p "require('./package.json').dependencies['istanbul-lib-coverage']"
```

Expected: `^3.2.2`

- [ ] **Step 2: Regenerate the lockfile for Linux**

Docker must be running.

```bash
npm run lock:linux
```

This is mandatory after any dependency change: npm on macOS never installs the wasm32-wasi optional packages, so it leaves their `@emnapi/*` transitive deps stale in the lock and `npm ci` breaks on Linux CI.

- [ ] **Step 3: Write the failing test**

Create `tests/mergeCoverage.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { mergeCoverage } from '../src/mergeCoverage.js';

// Minimal but structurally valid Istanbul file coverage. istanbul-lib-coverage
// validates the shape, so the maps cannot be omitted.
function fileCoverage(path, statementHits, fnHits = 0) {
  return {
    path,
    statementMap: { 0: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } } },
    fnMap: {
      0: {
        name: 'f',
        decl: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } },
        loc: { start: { line: 1, column: 0 }, end: { line: 3, column: 1 } },
      },
    },
    branchMap: {},
    s: { 0: statementHits },
    f: { 0: fnHits },
    b: {},
  };
}

describe('mergeCoverage', () => {
  it('sums statement hits for the same file across shards', () => {
    const merged = mergeCoverage([
      { '/app/src/a.js': fileCoverage('/app/src/a.js', 1) },
      { '/app/src/a.js': fileCoverage('/app/src/a.js', 2) },
    ]);
    expect(merged['/app/src/a.js'].s[0]).toBe(3);
  });

  it('sums function hits for the same file across shards', () => {
    const merged = mergeCoverage([
      { '/app/src/a.js': fileCoverage('/app/src/a.js', 1, 4) },
      { '/app/src/a.js': fileCoverage('/app/src/a.js', 1, 5) },
    ]);
    expect(merged['/app/src/a.js'].f[0]).toBe(9);
  });

  it('unions files that only one shard touched', () => {
    const merged = mergeCoverage([
      { '/app/src/a.js': fileCoverage('/app/src/a.js', 1) },
      { '/app/src/b.js': fileCoverage('/app/src/b.js', 7) },
    ]);
    expect(Object.keys(merged).sort()).toEqual(['/app/src/a.js', '/app/src/b.js']);
    expect(merged['/app/src/b.js'].s[0]).toBe(7);
  });

  // A shard with no coverage file reads back as null and must not break the merge.
  it('skips null and undefined entries', () => {
    const merged = mergeCoverage([
      null,
      { '/app/src/a.js': fileCoverage('/app/src/a.js', 2) },
      undefined,
    ]);
    expect(merged['/app/src/a.js'].s[0]).toBe(2);
  });

  it('returns an empty map for no input', () => {
    expect(mergeCoverage([])).toEqual({});
    expect(mergeCoverage([null])).toEqual({});
  });

  it('does not mutate its inputs', () => {
    const first = { '/app/src/a.js': fileCoverage('/app/src/a.js', 1) };
    mergeCoverage([first, { '/app/src/a.js': fileCoverage('/app/src/a.js', 5) }]);
    expect(first['/app/src/a.js'].s[0]).toBe(1);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest --run tests/mergeCoverage.test.js`
Expected: FAIL — `Failed to load ../src/mergeCoverage.js`.

- [ ] **Step 5: Write the implementation**

Create `src/mergeCoverage.js`:

```js
import libCoverage from 'istanbul-lib-coverage';

/**
 * Combines per-shard Istanbul coverage into one map.
 *
 * This is the one artifact that needed no bespoke merge logic: summing hit
 * counts across runs of the same code is exactly what CoverageMap.merge does,
 * and it is the same operation `nyc merge` performs.
 *
 * Nulls are skipped rather than rejected — a shard that collected no coverage
 * (a filtered run, or one that never loaded instrumented code) reads back as
 * null and simply does not contribute.
 */
export function mergeCoverage(coverageObjects) {
  const map = libCoverage.createCoverageMap({});
  for (const coverage of coverageObjects) {
    if (coverage) map.merge(coverage);
  }
  return map.toJSON();
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest --run tests/mergeCoverage.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/mergeCoverage.js tests/mergeCoverage.test.js
git commit -m "feat(coverage): merge per-shard Istanbul coverage maps"
```

---

### Task 6: Associative report merge with consistency validation

**Files:**
- Create: `src/mergeReports.js`
- Test: `tests/mergeReports.test.js`

**Interfaces:**
- Consumes: report objects produced by `buildRunReport` (Task 3).
- Produces: `mergeRunReports(reports: object[]) -> object` (same shape as one report; throws on inconsistency); `findMissingShards(report) -> number[]`; `reportTimings(report) -> { wallMs: number, computeMs: number }`; `reportTotals(report) -> { executed: number, notRun: number, consistent: boolean }`.

**Critical design point:** completeness (`1..total` all present) is deliberately **not** checked here. A 2-of-3 merge is a legal intermediate value, and rejecting it would make `mergeRunReports([mergeRunReports([a, b]), c])` throw — destroying associativity, which is the property that proves no test is lost or doubled. `findMissingShards` is exported separately and called by the merge *command* (Task 9).

- [ ] **Step 1: Write the failing test**

Create `tests/mergeReports.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  mergeRunReports,
  findMissingShards,
  reportTimings,
  reportTotals,
} from '../src/mergeReports.js';

const HANDLERS = [
  { id: 's1', name: 'Login', parent: null, type: 'suite' },
  { id: 't1', name: 'a', parent: 's1', type: 'test' },
  { id: 't2', name: 'b', parent: 's1', type: 'test' },
  { id: 't3', name: 'c', parent: 's1', type: 'test' },
];

const FINGERPRINT = 'sha256:deadbeef';

function makeReport(index, overrides = {}) {
  const {
    total = 3,
    tests = [{ id: `t${index}`, status: 'pass' }],
    startedAt = `2026-08-19T10:00:0${index}.000Z`,
    endedAt = `2026-08-19T10:00:1${index}.000Z`,
    durationMs = 10_000,
    executed = 1,
    notRun = 0,
    failed = 0,
    stoppedEarly = false,
    coverageFile = 'coverage.json',
    contracts = { configured: true, partial: false, results: [], skipped: [] },
    fingerprint = FINGERPRINT,
    schemaVersion = 1,
    totalTests = 3,
  } = overrides;

  return {
    schemaVersion,
    shards: [{
      index, total, startedAt, endedAt, durationMs,
      executed, notRun, failed, stoppedEarly, coverageFile, recording: null,
    }],
    discovery: { totalTests, fingerprint },
    selection: { filters: [] },
    handlers: HANDLERS,
    tests,
    contracts,
  };
}

describe('mergeRunReports', () => {
  it('concatenates tests across shards', () => {
    const merged = mergeRunReports([makeReport(1), makeReport(2), makeReport(3)]);
    expect(merged.tests.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });

  it('sorts shard descriptors by index regardless of input order', () => {
    const merged = mergeRunReports([makeReport(3), makeReport(1), makeReport(2)]);
    expect(merged.shards.map((s) => s.index)).toEqual([1, 2, 3]);
  });

  it('keeps the single-report shape', () => {
    const merged = mergeRunReports([makeReport(1), makeReport(2), makeReport(3)]);
    expect(Object.keys(merged).sort()).toEqual(
      ['contracts', 'discovery', 'handlers', 'schemaVersion', 'selection', 'shards', 'tests'],
    );
    expect(merged.handlers).toEqual(HANDLERS);
    expect(merged.discovery).toEqual({ totalTests: 3, fingerprint: FINGERPRINT });
  });

  // The property that proves nothing is lost or doubled. It only holds because
  // completeness is checked outside this function.
  it('is associative', () => {
    const a = makeReport(1);
    const b = makeReport(2);
    const c = makeReport(3);
    expect(mergeRunReports([mergeRunReports([a, b]), c]))
      .toEqual(mergeRunReports([a, b, c]));
    expect(mergeRunReports([a, mergeRunReports([b, c])]))
      .toEqual(mergeRunReports([a, b, c]));
  });

  it('accepts a partial merge without complaining about gaps', () => {
    const merged = mergeRunReports([makeReport(1), makeReport(2)]);
    expect(merged.shards.map((s) => s.index)).toEqual([1, 2]);
  });

  it('concatenates contract results and skipped entries', () => {
    const merged = mergeRunReports([
      makeReport(1, { contracts: { configured: true, partial: false, results: [{ alias: 'a' }], skipped: [{ alias: 'x' }] } }),
      makeReport(2, { contracts: { configured: true, partial: false, results: [{ alias: 'b' }], skipped: [] } }),
    ]);
    expect(merged.contracts.results).toEqual([{ alias: 'a' }, { alias: 'b' }]);
    expect(merged.contracts.skipped).toEqual([{ alias: 'x' }]);
  });

  it('ORs the contracts partial flag', () => {
    const partial = makeReport(2, { contracts: { configured: true, partial: true, results: [], skipped: [] } });
    expect(mergeRunReports([makeReport(1), partial]).contracts.partial).toBe(true);
    expect(mergeRunReports([makeReport(1), makeReport(2)]).contracts.partial).toBe(false);
  });

  it('throws on an empty input', () => {
    expect(() => mergeRunReports([])).toThrow(/No shard reports/);
  });

  it('throws when schema versions disagree', () => {
    expect(() => mergeRunReports([makeReport(1), makeReport(2, { schemaVersion: 2 })]))
      .toThrow(/schemaVersion/);
  });

  // The safety net: shards that saw different test sets must never be combined.
  it('throws when fingerprints disagree', () => {
    expect(() => mergeRunReports([makeReport(1), makeReport(2, { fingerprint: 'sha256:other' })]))
      .toThrow(/different test sets/);
  });

  it('throws when shard totals disagree', () => {
    expect(() => mergeRunReports([makeReport(1), makeReport(2, { total: 4 })]))
      .toThrow(/shard total/);
  });

  it('throws when the same shard index appears twice', () => {
    expect(() => mergeRunReports([makeReport(1), makeReport(1)]))
      .toThrow(/more than once/);
  });

  it('throws when a test id appears in two shards', () => {
    expect(() => mergeRunReports([
      makeReport(1, { tests: [{ id: 'dup', status: 'pass' }] }),
      makeReport(2, { tests: [{ id: 'dup', status: 'pass' }] }),
    ])).toThrow(/"dup" appears in more than one shard/);
  });

  it('does not mutate the input reports', () => {
    const a = makeReport(1);
    const b = makeReport(2);
    mergeRunReports([b, a]);
    expect(a.shards).toHaveLength(1);
    expect(b.shards[0].index).toBe(2);
  });
});

describe('findMissingShards', () => {
  it('returns an empty array when every shard is present', () => {
    expect(findMissingShards(mergeRunReports([makeReport(1), makeReport(2), makeReport(3)])))
      .toEqual([]);
  });

  it('names the gaps', () => {
    expect(findMissingShards(mergeRunReports([makeReport(1), makeReport(3)]))).toEqual([2]);
    expect(findMissingShards(mergeRunReports([makeReport(2)]))).toEqual([1, 3]);
  });
});

describe('reportTimings', () => {
  // Wall clock is what the developer waited; compute is what was paid for.
  it('reports wall clock as the span and compute as the sum', () => {
    const merged = mergeRunReports([makeReport(1), makeReport(2), makeReport(3)]);
    // starts 10:00:01..03, ends 10:00:11..13 -> span 12s; 3 x 10s compute
    expect(reportTimings(merged)).toEqual({ wallMs: 12_000, computeMs: 30_000 });
  });

  it('makes wall and compute equal for a single shard', () => {
    const single = mergeRunReports([makeReport(1, { total: 1 })]);
    const { wallMs, computeMs } = reportTimings(single);
    expect(wallMs).toBe(computeMs);
  });
});

describe('reportTotals', () => {
  it('sums executed and notRun and confirms they account for discovery', () => {
    const merged = mergeRunReports([makeReport(1), makeReport(2), makeReport(3)]);
    expect(reportTotals(merged)).toEqual({ executed: 3, notRun: 0, consistent: true });
  });

  it('flags totals that do not add up to the discovered count', () => {
    const merged = mergeRunReports([makeReport(1), makeReport(2)]);
    expect(reportTotals(merged).consistent).toBe(false);
  });

  it('counts a bailed shard\'s notRun', () => {
    const merged = mergeRunReports([
      makeReport(1),
      makeReport(2, { executed: 1, notRun: 1, stoppedEarly: true, failed: 1 }),
      makeReport(3),
    ]);
    expect(reportTotals(merged)).toEqual({ executed: 3, notRun: 1, consistent: false });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest --run tests/mergeReports.test.js`
Expected: FAIL — `Failed to load ../src/mergeReports.js`.

- [ ] **Step 3: Write the implementation**

Create `src/mergeReports.js`:

```js
/**
 * Combines shard reports into one report of the same shape.
 *
 * Only *consistency* is validated here — the things that stay true under a
 * partial merge. Completeness (is 1..total all present?) is checked by
 * findMissingShards, called from the merge command, because a 2-of-3 merge is a
 * legal intermediate value: rejecting it here would make
 * mergeRunReports([mergeRunReports([a, b]), c]) throw and destroy
 * associativity, which is the property that proves no test is lost or doubled.
 */
export function mergeRunReports(reports) {
  if (!reports.length) {
    throw new Error(
      'No shard reports to merge. Expected <dir>/*/run.json or <dir>/run.json.'
    );
  }

  const versions = [...new Set(reports.map((r) => r.schemaVersion))];
  if (versions.length > 1) {
    throw new Error(
      `Shard reports disagree on schemaVersion (${versions.sort().join(', ')}). ` +
      'Every shard job must run the same twd-cli version.'
    );
  }

  const fingerprints = new Set(reports.map((r) => r.discovery.fingerprint));
  if (fingerprints.size > 1) {
    throw new Error(
      'Shard reports discovered different test sets, so they cannot be merged. ' +
      'Either tests are registered conditionally (a feature flag, a date, ' +
      'Math.random), or the shard jobs did not build the same code.'
    );
  }

  const shards = reports.flatMap((r) => r.shards);

  const totals = [...new Set(shards.map((s) => s.total))];
  if (totals.length > 1) {
    throw new Error(
      `Shard reports disagree on shard total (${totals.sort((a, b) => a - b).join(', ')}). ` +
      'Every shard job must pass the same --shard total.'
    );
  }

  const byIndex = new Set();
  for (const shard of shards) {
    if (byIndex.has(shard.index)) {
      throw new Error(`Shard ${shard.index}/${shard.total} appears more than once.`);
    }
    byIndex.add(shard.index);
  }

  const tests = [];
  const testIds = new Set();
  for (const report of reports) {
    for (const test of report.tests) {
      if (testIds.has(test.id)) {
        throw new Error(
          `Test id "${test.id}" appears in more than one shard — the shard slices overlap.`
        );
      }
      testIds.add(test.id);
      tests.push(test);
    }
  }

  const first = reports[0];

  return {
    schemaVersion: first.schemaVersion,
    // Copy before sorting: sort mutates, and the input reports are the caller's.
    shards: [...shards].sort((a, b) => a.index - b.index),
    discovery: first.discovery,
    selection: first.selection,
    // Identical across shards, guaranteed by the fingerprint check above.
    handlers: first.handlers,
    tests,
    contracts: {
      configured: first.contracts.configured,
      partial: reports.some((r) => r.contracts.partial),
      results: reports.flatMap((r) => r.contracts.results),
      skipped: reports.flatMap((r) => r.contracts.skipped),
    },
  };
}

/**
 * Shard indices in 1..total that no report accounted for.
 *
 * A gap almost always means a shard job died before uploading its artifact. It
 * must be loud: a silent 3-of-4 merge reads as a complete green run.
 */
export function findMissingShards(report) {
  const total = report.shards[0]?.total ?? 0;
  const present = new Set(report.shards.map((s) => s.index));
  const missing = [];
  for (let i = 1; i <= total; i++) {
    if (!present.has(i)) missing.push(i);
  }
  return missing;
}

/**
 * Wall clock (what the developer waited) and compute (what was paid for).
 *
 * Derived rather than stored, so the two can never drift out of agreement with
 * the per-shard timestamps they come from.
 */
export function reportTimings(report) {
  const starts = report.shards.map((s) => Date.parse(s.startedAt));
  const ends = report.shards.map((s) => Date.parse(s.endedAt));
  return {
    wallMs: Math.max(...ends) - Math.min(...starts),
    computeMs: report.shards.reduce((sum, s) => sum + s.durationMs, 0),
  };
}

/**
 * Executed and not-run totals, plus whether they account for every discovered
 * test. An inconsistent result points at a shard-math bug, not user error.
 */
export function reportTotals(report) {
  const executed = report.shards.reduce((sum, s) => sum + s.executed, 0);
  const notRun = report.shards.reduce((sum, s) => sum + s.notRun, 0);
  return {
    executed,
    notRun,
    consistent: executed + notRun === report.discovery.totalTests,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest --run tests/mergeReports.test.js`
Expected: PASS, 22 tests.

- [ ] **Step 5: Commit**

```bash
git add src/mergeReports.js tests/mergeReports.test.js
git commit -m "feat(merge): associative report merge with consistency validation"
```

---

### Task 7: Per-shard breakdown in the run summary

**Files:**
- Modify: `src/testSummary.js`
- Test: `tests/testSummary.test.js`

**Interfaces:**
- Consumes: `shards` array from a merged report (Task 6), `computeMs` from `reportTimings`.
- Produces: `formatRunComplete({ testStatus, handlers, durationMs, notRun, stoppedEarly, maxFailures, shards, computeMs })` — two new optional params, both defaulting to `null`.

**Constraint:** with `shards` absent or of length 1, output must be byte-identical to today's.

- [ ] **Step 1: Write the failing test**

Append to `tests/testSummary.test.js`:

```js
describe('formatRunComplete with shards', () => {
  const handlers = [
    { id: 's1', name: 'Login', parent: null, type: 'suite' },
    { id: 't1', name: 'works', parent: 's1', type: 'test' },
  ];
  const testStatus = [{ id: 't1', status: 'pass' }];

  function shard(index, overrides = {}) {
    return { index, total: 4, executed: 30, failed: 0, notRun: 0, stoppedEarly: false, ...overrides };
  }

  it('adds a shard breakdown line when more than one shard merged', () => {
    const output = formatRunComplete({
      testStatus, handlers, durationMs: 38_200, computeMs: 134_200,
      shards: [shard(1), shard(2, { failed: 3 }), shard(3), shard(4)],
    });
    expect(output).toContain('Shards: 1 ✓30 | 2 ✗30 | 3 ✓30 | 4 ✓30');
  });

  it('reports wall clock and compute separately for a merged run', () => {
    const output = formatRunComplete({
      testStatus, handlers, durationMs: 38_200, computeMs: 134_200,
      shards: [shard(1), shard(2)],
    });
    expect(output).toContain('Duration: 38.2s wall | 134.2s across 2 shards');
  });

  // The existing single-run format must not shift.
  it('keeps the plain duration line when there are no shards', () => {
    const output = formatRunComplete({ testStatus, handlers, durationMs: 4_200 });
    expect(output).toContain('Duration: 4.2s');
    expect(output).not.toContain('wall');
    expect(output).not.toContain('Shards:');
  });

  it('keeps the plain duration line for a single shard', () => {
    const output = formatRunComplete({
      testStatus, handlers, durationMs: 4_200, computeMs: 4_200, shards: [shard(1, { total: 1 })],
    });
    expect(output).toContain('Duration: 4.2s');
    expect(output).not.toContain('Shards:');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest --run tests/testSummary.test.js`
Expected: FAIL — the breakdown and wall/compute assertions find no such line.

- [ ] **Step 3: Implement the breakdown**

In `src/testSummary.js`, extend the destructured parameters:

```js
export function formatRunComplete({
  testStatus,
  handlers,
  durationMs,
  notRun = 0,
  stoppedEarly = false,
  maxFailures,
  shards = null,
  computeMs = null,
}) {
```

Replace the existing duration block:

```js
  if (notRun > 0) lines.push(`  Not run: ${notRun}`);
  lines.push(`  Duration: ${duration}s`);
```

with:

```js
  if (notRun > 0) lines.push(`  Not run: ${notRun}`);

  // A merged run has two meaningful durations: the span the developer waited,
  // and the compute it consumed. A single run has only one, and its line must
  // stay byte-identical to what it has always printed.
  const merged = Array.isArray(shards) && shards.length > 1;
  if (merged) {
    const compute = (computeMs / 1000).toFixed(1);
    lines.push(`  Duration: ${duration}s wall | ${compute}s across ${shards.length} shards`);
    const cells = shards.map((s) => `${s.index} ${s.failed > 0 ? '✗' : '✓'}${s.executed}`);
    lines.push(`  Shards: ${cells.join(' | ')}`);
  } else {
    lines.push(`  Duration: ${duration}s`);
  }
```

- [ ] **Step 4: Run the full suite to verify nothing shifted**

Run: `npx vitest --run tests/testSummary.test.js`
Expected: PASS — the new tests plus every existing one, unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/testSummary.js tests/testSummary.test.js
git commit -m "feat(summary): add per-shard breakdown and wall vs compute duration"
```

---

### Task 8: Wire sharding and report writing into the run

**Files:**
- Modify: `src/index.js`
- Test: `tests/runTests.test.js`

**Interfaces:**
- Consumes: `selectShardIds` (Task 1), `buildRunReport` (Task 3), `writeRunReport` / `DEFAULT_REPORT_DIR` / `COVERAGE_FILE` (Task 4).
- Produces: `runTests({ testFilters, recordOverrides, shard, reportDir }) -> Promise<boolean>`. Two new options; the return value is unchanged.

This is the task where the Global Constraint bites hardest. With `shard` absent, every conditional below must reduce to the expression it replaced.

- [ ] **Step 1: Write the failing tests**

Append to `tests/runTests.test.js`:

```js
describe('runTests sharding', () => {
  function fourTests() {
    return {
      handlers: [
        { id: '1', name: 'a', type: 'test' },
        { id: '2', name: 'b', type: 'test' },
        { id: '3', name: 'c', type: 'test' },
        { id: '4', name: 'd', type: 'test' },
      ],
      testStatus: [{ id: '2', status: 'pass' }, { id: '4', status: 'pass' }],
    };
  }

  function runJson() {
    const call = vi.mocked(fs.writeFileSync).mock.calls
      .find(([file]) => String(file).endsWith('run.json'));
    return call ? JSON.parse(call[1]) : null;
  }

  // Round-robin: shard 2 of 2 takes the odd indices, i.e. the 2nd and 4th ids.
  it('runs only its round-robin slice', async () => {
    const { handlers, testStatus } = fourTests();
    const page = createMockPage({ handlers, testStatus });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));

    await runTests({ shard: { index: 2, total: 2 } });

    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 2, ['2', '4']);
  });

  it('writes a run report to the default report dir', async () => {
    const { handlers, testStatus } = fourTests();
    const page = createMockPage({ handlers, testStatus });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));

    await runTests({ shard: { index: 2, total: 2 } });

    expect(fs.mkdirSync).toHaveBeenCalledWith('./.twd/run', { recursive: true });
    const report = runJson();
    expect(report.schemaVersion).toBe(1);
    expect(report.shards[0]).toMatchObject({ index: 2, total: 2, executed: 2 });
    expect(report.discovery.totalTests).toBe(4);
    expect(report.tests.map((t) => t.id)).toEqual(['2', '4']);
  });

  it('honors --report-dir', async () => {
    const { handlers, testStatus } = fourTests();
    const page = createMockPage({ handlers, testStatus });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));

    await runTests({ shard: { index: 1, total: 1 }, reportDir: './out' });

    expect(fs.mkdirSync).toHaveBeenCalledWith('./out', { recursive: true });
  });

  it('writes no report when not sharded', async () => {
    const { handlers, testStatus } = fourTests();
    const page = createMockPage({ handlers, testStatus });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));

    await runTests();

    expect(runJson()).toBeNull();
  });

  // 3 tests across 4 shards leaves the fourth with nothing to run. It must
  // still write a valid report, or merge sees a gap it cannot explain.
  it('writes a valid empty report when its slice is empty', async () => {
    const handlers = [
      { id: '1', name: 'a', type: 'test' },
      { id: '2', name: 'b', type: 'test' },
      { id: '3', name: 'c', type: 'test' },
    ];
    const page = createMockPage({ handlers, testStatus: [] });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));

    const hasFailures = await runTests({ shard: { index: 4, total: 4 } });

    expect(hasFailures).toBe(false);
    const report = runJson();
    expect(report.tests).toEqual([]);
    expect(report.shards[0]).toMatchObject({ index: 4, total: 4, executed: 0, failed: 0 });
    // The fingerprint still covers the whole suite, so an empty shard merges
    // cleanly with the three that ran something.
    expect(report.discovery.totalTests).toBe(3);
  });

  // Filters resolve first, then the filtered list is sharded. A filtered run's
  // coverage is a misleading project-wide number, sharded or not.
  it('skips coverage when a filter is combined with a shard', async () => {
    const { handlers, testStatus } = fourTests();
    const page = createMockPage({ handlers, testStatus });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, coverage: true });

    await runTests({ shard: { index: 1, total: 2 }, testFilters: ['a'] });

    const files = vi.mocked(fs.writeFileSync).mock.calls.map(([f]) => String(f));
    expect(files.some((f) => f.endsWith('coverage.json'))).toBe(false);
    expect(runJson().shards[0].coverageFile).toBeNull();
    expect(runJson().selection.filters).toEqual(['a']);
  });
});

describe('runTests non-regression: non-sharded behavior is unchanged', () => {
  // The !hasFailures coverage gate is relaxed only for sharded runs. A plain
  // failing run must still write nothing, exactly as in 1.4.0.
  it('writes no coverage when a non-sharded run fails', async () => {
    const handlers = [{ id: '1', name: 'a', type: 'test' }];
    const page = createMockPage({ handlers, testStatus: [{ id: '1', status: 'fail', error: 'boom' }] });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, coverage: true });

    await runTests();

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  // Likewise the early-stop contract skip.
  it('still skips contract validation when a non-sharded run stops early', async () => {
    const handlers = [{ id: '1', name: 'a', type: 'test' }];
    const page = createMockPage({ handlers, testStatus: [{ id: '1', status: 'fail', error: 'boom' }] });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig, maxFailures: 1, contracts: [{ source: 'api.json' }],
    });
    vi.mocked(loadContracts).mockResolvedValue([]);

    await runTests();

    expect(validateMocks).not.toHaveBeenCalled();
  });
});

describe('runTests sharded behavior changes', () => {
  it('writes coverage for a sharded run that fails', async () => {
    const handlers = [{ id: '1', name: 'a', type: 'test' }];
    const page = createMockPage({ handlers, testStatus: [{ id: '1', status: 'fail', error: 'boom' }] });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, coverage: true });

    await runTests({ shard: { index: 1, total: 1 } });

    const files = vi.mocked(fs.writeFileSync).mock.calls.map(([f]) => String(f));
    expect(files.some((f) => f.endsWith('coverage.json'))).toBe(true);
    // Never the path nyc reads by default: a shard's partial coverage there
    // would masquerade as the whole run's.
    expect(files.some((f) => f.includes('.nyc_output'))).toBe(false);
  });

  it('validates contracts on a sharded early stop and marks them partial', async () => {
    const handlers = [{ id: '1', name: 'a', type: 'test' }];
    const page = createMockPage({ handlers, testStatus: [{ id: '1', status: 'fail', error: 'boom' }] });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig, maxFailures: 1, contracts: [{ source: 'api.json' }],
    });
    vi.mocked(loadContracts).mockResolvedValue([]);
    vi.mocked(validateMocks).mockReturnValue({ results: [{ alias: 'a' }], skipped: [] });
    vi.mocked(printContractReport).mockReturnValue(false);

    await runTests({ shard: { index: 1, total: 1 } });

    expect(validateMocks).toHaveBeenCalled();
    const call = vi.mocked(fs.writeFileSync).mock.calls
      .find(([file]) => String(file).endsWith('run.json'));
    const report = JSON.parse(call[1]);
    expect(report.contracts).toMatchObject({ configured: true, partial: true });
    expect(report.contracts.results).toEqual([{ alias: 'a' }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest --run tests/runTests.test.js`
Expected: FAIL — the shard slice assertion sees all four ids, and no `run.json` is written.

- [ ] **Step 3: Add imports and options**

In `src/index.js`, add to the import block:

```js
import { selectShardIds } from './shard.js';
import { buildRunReport } from './runReport.js';
import { writeRunReport, DEFAULT_REPORT_DIR, COVERAGE_FILE } from './reportFiles.js';
```

Change the destructure at line 46:

```js
  const { testFilters = [], recordOverrides = {}, shard = null, reportDir = null } = options;
  const sharded = Boolean(shard);
```

Add one declaration alongside the other `let`s near the top of the function, so the recording details can reach the report:

```js
  let recordingInfo = null;
```

- [ ] **Step 4: Slice the ids**

Replace line 164:

```js
    const baseIds = selectedIds ?? orderedTestIds(registeredHandlers);
```

with:

```js
    // The full ordered list, before filtering or slicing. This is what the
    // fingerprint hashes and what discovery.totalTests reports, so every shard
    // agrees on it regardless of which slice it took.
    const allTestIds = orderedTestIds(registeredHandlers);
    const filteredIds = selectedIds ?? allTestIds;
    const baseIds = sharded
      ? selectShardIds(filteredIds, shard.index, shard.total)
      : filteredIds;

    if (sharded) {
      console.log(
        `Shard ${shard.index}/${shard.total}: running ${baseIds.length} of ${filteredIds.length} test(s).`
      );
    }
```

- [ ] **Step 5: Capture recording details for the report**

In the recording success branch (around line 277), replace:

```js
      } else {
        console.log(`Recorded ${executed} test(s) to ${recordOutput}`);
      }
```

with:

```js
      } else {
        recordingInfo = { file: recordOutput, bytes: recordedFileSize(recordOutputPath) };
        console.log(`Recorded ${executed} test(s) to ${recordOutput}`);
      }
```

- [ ] **Step 6: Capture the end timestamp**

Replace line 282:

```js
    const durationMs = Date.now() - startedAt;
```

with:

```js
    const endedAt = Date.now();
    const durationMs = endedAt - startedAt;
```

- [ ] **Step 7: Gate the contract change on sharding**

Replace the whole contract block (lines 296-319) with:

```js
    // Contract validation. A sharded run validates even after an early stop and
    // flags the result partial, so merge can say exactly what is missing rather
    // than silently dropping a shard's worth of mocks. A non-sharded run keeps
    // skipping, exactly as before.
    const contractsConfigured = Boolean(config.contracts && config.contracts.length > 0);
    let contractsBlock = {
      configured: contractsConfigured,
      partial: false,
      results: [],
      skipped: [],
    };

    if (contractsConfigured && (sharded || !stoppedEarly)) {
      if (collectedMocks.size === 0) {
        console.log('\nNo mocks collected — ensure twd-js supports contract collection');
      }
      const validationOutput = validateMocks(collectedMocks, contractValidators);
      const hasContractErrors = printContractReport(validationOutput);
      if (hasContractErrors) {
        hasFailures = true;
      }

      contractsBlock = {
        configured: true,
        partial: stoppedEarly,
        results: validationOutput.results,
        skipped: validationOutput.skipped,
      };

      if (stoppedEarly) {
        console.log('\n⚠ Contract data is partial — this shard stopped early.');
      }

      // Only a whole run produces a meaningful markdown report. Under sharding
      // each shard would overwrite the others with a quarter of the picture, so
      // `merge` writes it instead.
      if (config.contractReportPath && !sharded) {
        const reportPath = path.resolve(workingDir, config.contractReportPath);
        const reportDirPath = path.dirname(reportPath);
        if (!fs.existsSync(reportDirPath)) {
          fs.mkdirSync(reportDirPath, { recursive: true });
        }
        const markdown = generateContractMarkdown(validationOutput);
        fs.writeFileSync(reportPath, markdown);
        console.log(`Contract report written to ${config.contractReportPath}`);
      }
    } else if (contractsConfigured && stoppedEarly) {
      console.log('\nSkipping contract validation — run stopped early (partial data).');
    }
```

- [ ] **Step 8: Gate the coverage change on sharding**

Replace the whole coverage block (lines 321-344) with:

```js
    // Handle code coverage.
    //
    // The filter gate is unchanged: a --test filter still suppresses coverage,
    // because a filtered run's number is a misleading project-wide figure. A
    // shard slice is not a filter.
    //
    // The failure gate is relaxed for sharded runs only. hasFailures is per
    // shard, so applying it here would let three green shards write coverage
    // while a red fourth writes none — a merged report that looks complete but
    // is missing a quarter of the code paths. `merge` applies the gate to the
    // true global result instead.
    if (selectedIds && config.coverage) {
      console.log('Skipping coverage collection (test filter active).');
    }

    let coverageData = null;
    if (config.coverage && !selectedIds && (sharded || !hasFailures)) {
      coverageData = await page.evaluate(() => window.__coverage__);
      if (!coverageData) {
        console.log('No code coverage data found.');
      }
    }

    // A sharded run's coverage goes to the report dir and nowhere else. Writing
    // it to .nyc_output/out.json — the path nyc reads by default — would let one
    // shard's partial data masquerade as the whole run's.
    if (coverageData && !sharded) {
      const coverageDir = path.resolve(workingDir, config.coverageDir);
      const nycDir = path.resolve(workingDir, config.nycOutputDir);

      if (!fs.existsSync(nycDir)) {
        fs.mkdirSync(nycDir, { recursive: true });
      }
      if (!fs.existsSync(coverageDir)) {
        fs.mkdirSync(coverageDir, { recursive: true });
      }

      const coveragePath = path.join(nycDir, 'out.json');
      fs.writeFileSync(coveragePath, JSON.stringify(coverageData));
      console.log(`Code coverage data written to ${coveragePath}`);
    }
```

- [ ] **Step 9: Write the shard report**

After the `formatRunComplete` block (line 357) and before `return hasFailures;`, insert:

```js
    // Written last, and only for a sharded run. A run that threw never gets
    // here on purpose: its artifact stays absent, and `merge` reports the gap as
    // "a shard job likely failed before uploading", which is the accurate
    // diagnosis. A half-written report would be a worse lie.
    if (sharded) {
      const dir = reportDir ?? DEFAULT_REPORT_DIR;
      const report = buildRunReport({
        shard,
        startedAt,
        endedAt,
        allTestIds,
        filters: testFilters,
        handlers,
        tests: testStatus,
        executed,
        notRun,
        stoppedEarly,
        coverageFile: coverageData ? COVERAGE_FILE : null,
        recording: recordingInfo,
        contracts: contractsBlock,
      });
      const { reportPath } = writeRunReport(dir, report, coverageData);
      console.log(`Shard report written to ${reportPath}`);
    }
```

- [ ] **Step 10: Run the full suite**

Run: `npm run test:ci`
Expected: PASS — every existing test plus the new ones. The two non-regression tests are the ones that matter most here.

- [ ] **Step 11: Commit**

```bash
git add src/index.js tests/runTests.test.js
git commit -m "feat(run): slice tests by shard and write a run report artifact"
```

---

### Task 9: The `merge` command

**Files:**
- Create: `src/mergeCommand.js`
- Modify: `bin/twd-cli.js`
- Test: `tests/mergeCommand.test.js`

**Interfaces:**
- Consumes: `readShardReports` / `readShardCoverage` / `DEFAULT_MERGED_OUT` (Task 4), `mergeCoverage` (Task 5), `mergeRunReports` / `findMissingShards` / `reportTimings` / `reportTotals` (Task 6), `formatRunComplete` (Task 7), plus the existing `loadConfig`, `printContractReport`, `generateContractMarkdown`.
- Produces: `runMerge({ dir, out }) -> boolean` (true when the merged run has failures). Throws on unusable input.

- [ ] **Step 1: Write the failing test**

Create `tests/mergeCommand.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs');
vi.mock('../src/config.js', () => ({ loadConfig: vi.fn() }));
vi.mock('../src/contractReport.js', () => ({ printContractReport: vi.fn() }));
vi.mock('../src/reportFiles.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, readShardReports: vi.fn(), readShardCoverage: vi.fn() };
});

import fs from 'fs';
import { loadConfig } from '../src/config.js';
import { printContractReport } from '../src/contractReport.js';
import { readShardReports, readShardCoverage } from '../src/reportFiles.js';
import { runMerge } from '../src/mergeCommand.js';

const HANDLERS = [
  { id: 's1', name: 'Login', parent: null, type: 'suite' },
  { id: 't1', name: 'a', parent: 's1', type: 'test' },
  { id: 't2', name: 'b', parent: 's1', type: 'test' },
];

function shardReport(index, overrides = {}) {
  const { total = 2, tests = [{ id: `t${index}`, status: 'pass' }], failed = 0 } = overrides;
  return {
    schemaVersion: 1,
    shards: [{
      index, total,
      startedAt: `2026-08-19T10:00:0${index}.000Z`,
      endedAt: `2026-08-19T10:00:1${index}.000Z`,
      durationMs: 10_000,
      executed: 1, notRun: 0, failed,
      stoppedEarly: false, coverageFile: 'coverage.json', recording: null,
    }],
    discovery: { totalTests: 2, fingerprint: 'sha256:same' },
    selection: { filters: [] },
    handlers: HANDLERS,
    tests,
    contracts: { configured: false, partial: false, results: [], skipped: [] },
  };
}

const baseConfig = {
  coverage: true,
  nycOutputDir: './.nyc_output',
  maxFailures: 10,
};

function writtenFiles() {
  return vi.mocked(fs.writeFileSync).mock.calls.map(([f]) => String(f));
}

describe('runMerge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadConfig).mockReturnValue({ ...baseConfig });
    vi.mocked(readShardCoverage).mockReturnValue(null);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requires a directory', () => {
    expect(() => runMerge({})).toThrow(/Usage: twd-cli merge/);
  });

  it('errors when no shard reports were found', () => {
    vi.mocked(readShardReports).mockReturnValue([]);
    expect(() => runMerge({ dir: '.twd/shards' })).toThrow(/No shard reports found/);
  });

  // The failure that must never be silent: three green shards and one that
  // never uploaded would otherwise read as a complete green run.
  it('errors and names the gap when a shard is missing', () => {
    vi.mocked(readShardReports).mockReturnValue([{ dir: 'a', report: shardReport(1) }]);
    expect(() => runMerge({ dir: '.twd/shards' })).toThrow(/Missing shard report\(s\): 2\/2/);
  });

  it('mentions if: always() in the missing-shard message', () => {
    vi.mocked(readShardReports).mockReturnValue([{ dir: 'a', report: shardReport(2) }]);
    expect(() => runMerge({ dir: '.twd/shards' })).toThrow(/if: always\(\)/);
  });

  it('writes the merged report to the default path', () => {
    vi.mocked(readShardReports).mockReturnValue([
      { dir: 'a', report: shardReport(1) },
      { dir: 'b', report: shardReport(2) },
    ]);

    expect(runMerge({ dir: '.twd/shards' })).toBe(false);

    const merged = writtenFiles().find((f) => f.endsWith('merged-run.json'));
    expect(merged).toBeDefined();
  });

  it('honors --out', () => {
    vi.mocked(readShardReports).mockReturnValue([
      { dir: 'a', report: shardReport(1) },
      { dir: 'b', report: shardReport(2) },
    ]);

    runMerge({ dir: '.twd/shards', out: 'custom.json' });

    expect(writtenFiles().some((f) => f.endsWith('custom.json'))).toBe(true);
  });

  it('returns true when any shard had a failing test', () => {
    vi.mocked(readShardReports).mockReturnValue([
      { dir: 'a', report: shardReport(1) },
      { dir: 'b', report: shardReport(2, { tests: [{ id: 't2', status: 'fail', error: 'boom' }], failed: 1 }) },
    ]);

    expect(runMerge({ dir: '.twd/shards' })).toBe(true);
  });

  it('merges coverage when the run is green', () => {
    vi.mocked(readShardReports).mockReturnValue([
      { dir: 'a', report: shardReport(1) },
      { dir: 'b', report: shardReport(2) },
    ]);
    vi.mocked(readShardCoverage).mockReturnValue({});

    runMerge({ dir: '.twd/shards' });

    expect(writtenFiles().some((f) => f.includes('.nyc_output'))).toBe(true);
  });

  // The user's rule, applied to the true global result rather than one shard's.
  it('skips merged coverage when the run is red', () => {
    vi.mocked(readShardReports).mockReturnValue([
      { dir: 'a', report: shardReport(1) },
      { dir: 'b', report: shardReport(2, { tests: [{ id: 't2', status: 'fail', error: 'boom' }], failed: 1 }) },
    ]);
    vi.mocked(readShardCoverage).mockReturnValue({});

    runMerge({ dir: '.twd/shards' });

    expect(writtenFiles().some((f) => f.includes('.nyc_output'))).toBe(false);
  });

  it('reports how many shards contributed coverage', () => {
    const log = vi.spyOn(console, 'log');
    vi.mocked(readShardReports).mockReturnValue([
      { dir: 'a', report: shardReport(1) },
      { dir: 'b', report: shardReport(2) },
    ]);
    vi.mocked(readShardCoverage).mockReturnValueOnce({}).mockReturnValueOnce(null);

    runMerge({ dir: '.twd/shards' });

    expect(log.mock.calls.flat().join('\n')).toMatch(/Coverage merged from 1\/2 shards/);
  });

  it('says so when no shard had coverage', () => {
    const log = vi.spyOn(console, 'log');
    vi.mocked(readShardReports).mockReturnValue([
      { dir: 'a', report: shardReport(1) },
      { dir: 'b', report: shardReport(2) },
    ]);

    runMerge({ dir: '.twd/shards' });

    expect(log.mock.calls.flat().join('\n')).toMatch(/No coverage data found/);
  });

  it('returns true when contracts report an error-mode violation', () => {
    const withContracts = (i) => ({
      ...shardReport(i),
      contracts: { configured: true, partial: false, results: [{ alias: 'a' }], skipped: [] },
    });
    vi.mocked(readShardReports).mockReturnValue([
      { dir: 'a', report: withContracts(1) },
      { dir: 'b', report: withContracts(2) },
    ]);
    vi.mocked(printContractReport).mockReturnValue(true);

    expect(runMerge({ dir: '.twd/shards' })).toBe(true);
  });

  it('warns when contract data is partial', () => {
    const warn = vi.spyOn(console, 'warn');
    const partial = (i, isPartial) => ({
      ...shardReport(i),
      contracts: { configured: true, partial: isPartial, results: [], skipped: [] },
    });
    vi.mocked(readShardReports).mockReturnValue([
      { dir: 'a', report: partial(1, false) },
      { dir: 'b', report: partial(2, true) },
    ]);
    vi.mocked(printContractReport).mockReturnValue(false);

    runMerge({ dir: '.twd/shards' });

    expect(warn.mock.calls.flat().join('\n')).toMatch(/contract data is partial/i);
  });

  it('prints the merged run-complete block with a shard breakdown', () => {
    const log = vi.spyOn(console, 'log');
    vi.mocked(readShardReports).mockReturnValue([
      { dir: 'a', report: shardReport(1) },
      { dir: 'b', report: shardReport(2) },
    ]);

    runMerge({ dir: '.twd/shards' });

    const output = log.mock.calls.flat().join('\n');
    expect(output).toContain('--- Run complete ---');
    expect(output).toContain('Shards: 1 ✓1 | 2 ✓1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest --run tests/mergeCommand.test.js`
Expected: FAIL — `Failed to load ../src/mergeCommand.js`.

- [ ] **Step 3: Write the implementation**

Create `src/mergeCommand.js`:

```js
import fs from 'fs';
import path from 'path';
import { loadConfig } from './config.js';
import {
  readShardReports,
  readShardCoverage,
  DEFAULT_MERGED_OUT,
} from './reportFiles.js';
import {
  mergeRunReports,
  findMissingShards,
  reportTimings,
  reportTotals,
} from './mergeReports.js';
import { mergeCoverage } from './mergeCoverage.js';
import { formatRunComplete } from './testSummary.js';
import { printContractReport } from './contractReport.js';
import { generateContractMarkdown } from './contractMarkdown.js';

/**
 * Joins per-shard reports into one and reports on the whole run.
 *
 * This function owns the run's exit code. Shard jobs each exit 1 on their own
 * failures, so the workflow only reaches here with `if: !cancelled()`, and the
 * merged verdict is the one that counts.
 */
export function runMerge({ dir, out = null } = {}) {
  if (!dir) {
    throw new Error('Usage: twd-cli merge <dir> [--out <path>]');
  }

  const config = loadConfig();
  const workingDir = process.cwd();

  const found = readShardReports(dir);
  if (found.length === 0) {
    throw new Error(
      `No shard reports found in ${dir}. ` +
      'Expected <dir>/*/run.json (the actions/download-artifact layout) or <dir>/run.json.'
    );
  }

  const merged = mergeRunReports(found.map((f) => f.report));

  // Completeness is enforced here rather than inside mergeRunReports, which must
  // stay associative. A gap is never a warning: a silent 3-of-4 merge reads as a
  // complete green run.
  const missing = findMissingShards(merged);
  if (missing.length > 0) {
    const total = merged.shards[0].total;
    throw new Error(
      `Missing shard report(s): ${missing.map((i) => `${i}/${total}`).join(', ')}. ` +
      'A shard job likely failed before uploading its artifact — check that the ' +
      'upload step runs with `if: always()`.'
    );
  }

  const outPath = path.resolve(workingDir, out ?? DEFAULT_MERGED_OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`Merged report written to ${outPath}`);

  let hasFailures = merged.tests.some((test) => test.status === 'fail');

  if (merged.contracts.configured) {
    const validationOutput = {
      results: merged.contracts.results,
      skipped: merged.contracts.skipped,
    };
    if (printContractReport(validationOutput)) {
      hasFailures = true;
    }
    if (merged.contracts.partial) {
      console.warn(
        'Warning: contract data is partial — at least one shard stopped early, so ' +
        'some mocks were never collected.'
      );
    }
    if (config.contractReportPath) {
      const reportPath = path.resolve(workingDir, config.contractReportPath);
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, generateContractMarkdown(validationOutput));
      console.log(`Contract report written to ${config.contractReportPath}`);
    }
  }

  // A red run yields no coverage — the same policy a single run has always had,
  // but keyed on the whole merged result instead of one shard's.
  if (config.coverage) {
    const coverages = found.map((f) =>
      readShardCoverage(f.dir, f.report.shards[0]?.coverageFile ?? null)
    );
    const contributors = coverages.filter(Boolean).length;

    if (contributors === 0) {
      console.log('No coverage data found in any shard.');
    } else if (hasFailures) {
      console.log(
        `Skipping merged coverage — the run has failures ` +
        `(${contributors}/${found.length} shard(s) had data).`
      );
    } else {
      const nycDir = path.resolve(workingDir, config.nycOutputDir);
      fs.mkdirSync(nycDir, { recursive: true });
      fs.writeFileSync(path.join(nycDir, 'out.json'), JSON.stringify(mergeCoverage(coverages)));
      console.log(
        `Coverage merged from ${contributors}/${found.length} shards to ` +
        `${config.nycOutputDir}/out.json`
      );
    }
  }

  const totals = reportTotals(merged);
  if (!totals.consistent) {
    console.warn(
      `Warning: shard totals do not add up — ${totals.executed} executed + ` +
      `${totals.notRun} not run != ${merged.discovery.totalTests} discovered. ` +
      'This points at a shard-slicing bug, not at your tests.'
    );
  }

  const timings = reportTimings(merged);
  console.log('');
  console.log(formatRunComplete({
    testStatus: merged.tests,
    handlers: merged.handlers,
    durationMs: timings.wallMs,
    computeMs: timings.computeMs,
    notRun: totals.notRun,
    shards: merged.shards,
    stoppedEarly: merged.shards.some((s) => s.stoppedEarly),
    maxFailures: config.maxFailures,
  }));

  return hasFailures;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest --run tests/mergeCommand.test.js`
Expected: PASS, 15 tests.

- [ ] **Step 5: Wire the subcommand into the CLI**

In `bin/twd-cli.js`, extend the imports:

```js
import { runTests } from '../src/index.js';
import { parseRunArgs, parseMergeArgs } from '../src/parseArgs.js';
import { runMerge } from '../src/mergeCommand.js';
```

Change the `run` branch to forward the new options:

```js
    const { testFilters, record, shard, reportDir } = parseRunArgs(process.argv.slice(3));
    const hasFailures = await runTests({
      testFilters,
      recordOverrides: record,
      shard,
      reportDir,
    });
```

Add a `merge` branch immediately after the `run` block's closing brace:

```js
} else if (command === 'merge') {
  try {
    const { dir, out } = parseMergeArgs(process.argv.slice(3));
    const hasFailures = runMerge({ dir, out });
    process.exit(hasFailures ? 1 : 0);
  } catch (error) {
    if (!error?.reported) {
      console.error(error?.message ?? String(error));
    }
    process.exit(1);
  }
} else {
```

- [ ] **Step 6: Update the help text**

In the same file's help block, add to `Usage:`:

```
  npx twd-cli run --shard 2/4      Run only this shard's slice of the suite
                                   and write a report to ./.twd/run
  npx twd-cli merge <dir>          Merge shard reports from <dir> into one
                                   report, and exit 1 if the whole run failed
```

Add to `Options:`:

```
  --shard <i>/<n>        Run slice i of n. Each shard discovers the whole
                         suite and takes every nth test, so the test count
                         never has to be known in advance. Implies a report.
  --report-dir <path>    Where to write the shard report (default ./.twd/run)
```

And add an example:

```
  npx twd-cli run --shard 2/4
  npx twd-cli merge .twd/shards
```

- [ ] **Step 7: Verify the CLI end to end by hand**

```bash
node ./bin/twd-cli.js merge
```

Expected: prints `Usage: twd-cli merge <dir> [--out <path>]` and exits 1.

```bash
node ./bin/twd-cli.js merge /tmp/definitely-not-here; echo "exit=$?"
```

Expected: prints `No shard reports found in /tmp/definitely-not-here. ...` and `exit=1`.

```bash
node ./bin/twd-cli.js
```

Expected: help text including the `--shard` and `merge` entries.

- [ ] **Step 8: Run the full suite and commit**

Run: `npm run test:ci`
Expected: PASS.

```bash
git add src/mergeCommand.js tests/mergeCommand.test.js bin/twd-cli.js
git commit -m "feat(cli): add the merge command and wire shard flags through bin"
```

---

### Task 10: End-to-end verification of the CI plumbing

**Files:**
- Modify: `.github/workflows/e2e.yml`

**Interfaces:**
- Consumes: the finished CLI from Tasks 1-9.
- Produces: nothing consumed by later tasks.

Unit tests cannot catch a missing `if: always()`, a wrong artifact path, or a `fail-fast` that cancels siblings. This job is the only place the real plumbing runs.

- [ ] **Step 1: Add the sharded job**

Append to `.github/workflows/e2e.yml`, after the existing `e2e` job (same indentation level — two spaces, a sibling of `unit-tests` and `e2e`):

```yaml
  e2e-sharded:
    runs-on: ubuntu-latest

    strategy:
      # Without this, the first red shard cancels its siblings and the merge job
      # sees gaps it cannot distinguish from a crashed shard.
      fail-fast: false
      matrix:
        shard: [1, 2]

    steps:
      - name: Checkout repo
        uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd # v5

      - name: Setup Node.js
        uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5
        with:
          node-version: 24
          cache: npm

      - name: Install CLI dependencies
        run: npm ci

      - name: Install test-example-app dependencies
        working-directory: test-example-app
        run: npm install

      - name: Install mock service worker
        working-directory: test-example-app
        run: npx twd-js init public --save

      - name: Cache Puppeteer browsers
        uses: actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830 # v4
        with:
          path: ~/.cache/puppeteer
          key: ${{ runner.os }}-puppeteer-${{ hashFiles('package-lock.json') }}
          restore-keys: |
            ${{ runner.os }}-puppeteer-

      - name: Install Chrome for Puppeteer
        run: npx puppeteer browsers install chrome

      - name: Start dev server
        working-directory: test-example-app
        run: |
          nohup npx vite --host > vite.log 2>&1 &
          npx wait-on http://localhost:5173 --timeout 30000

      - name: Run TWD tests for this shard
        working-directory: test-example-app
        run: node ../bin/twd-cli.js run --shard ${{ matrix.shard }}/2

      - name: Upload shard report
        # Always: a red shard must still upload, or merge cannot tell "this shard
        # failed" from "this shard never ran".
        if: always()
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: twd-run-${{ matrix.shard }}
          path: test-example-app/.twd/run
          if-no-files-found: error

  e2e-merge:
    runs-on: ubuntu-latest
    needs: [e2e-sharded]
    # Runs even though a shard job may have exited 1. Without this the merged
    # summary — the point of the exercise — is never printed.
    if: ${{ !cancelled() }}

    steps:
      - name: Checkout repo
        uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd # v5

      - name: Setup Node.js
        uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5
        with:
          node-version: 24
          cache: npm

      - name: Install CLI dependencies
        run: npm ci

      - name: Download shard reports
        uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4
        with:
          pattern: twd-run-*
          path: test-example-app/.twd/shards

      - name: Merge shard reports
        working-directory: test-example-app
        run: node ../bin/twd-cli.js merge .twd/shards

      - name: Verify the merged report
        working-directory: test-example-app
        run: |
          if [ ! -f .twd/merged-run.json ]; then
            echo "ERROR: merged report not generated"
            exit 1
          fi
          node -e "
            const r = require('./.twd/merged-run.json');
            if (r.shards.length !== 2) {
              console.error('ERROR: expected 2 shards, got ' + r.shards.length);
              process.exit(1);
            }
            if (r.tests.length !== r.discovery.totalTests) {
              console.error('ERROR: ' + r.tests.length + ' merged tests but ' +
                r.discovery.totalTests + ' discovered');
              process.exit(1);
            }
            console.log('Merged ' + r.tests.length + ' tests from ' + r.shards.length + ' shards');
          "
```

- [ ] **Step 2: Verify the action SHAs resolve**

The `upload-artifact` and `download-artifact` SHAs above must be real v4 tags. Confirm before pushing:

```bash
gh api repos/actions/upload-artifact/git/ref/tags/v4 --jq .object.sha
gh api repos/actions/download-artifact/git/ref/tags/v4 --jq .object.sha
```

Replace the pinned SHAs in the YAML with whatever these print, keeping the `# v4` comment. Every other action in this file is SHA-pinned; these must match that convention.

- [ ] **Step 3: Validate the YAML parses**

```bash
node -e "
  const fs = require('fs');
  const text = fs.readFileSync('.github/workflows/e2e.yml', 'utf-8');
  if (!text.includes('e2e-sharded') || !text.includes('e2e-merge')) {
    throw new Error('jobs missing');
  }
  console.log('jobs present');
"
npx --yes yaml-lint .github/workflows/e2e.yml 2>/dev/null || echo "(yaml-lint unavailable — rely on CI)"
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/e2e.yml
git commit -m "ci: verify sharded runs and merge end to end"
```

- [ ] **Step 5: Push and confirm the workflow is green**

```bash
git push -u origin feat/shardable-run-artifacts
gh run watch
```

Expected: `unit-tests`, `e2e`, both `e2e-sharded` matrix legs, and `e2e-merge` all pass. If `e2e-merge` reports a missing shard, the upload path or artifact name is wrong — not the merge logic.

---

### Task 11: Documentation and the beta version bump

**Files:**
- Modify: `README.md` (new section after "CI/CD Integration", before "Contract Validation" at line 270)
- Modify: `CHANGELOG.md`
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Consumes: everything above.
- Produces: a publishable `1.5.0-beta.0`.

- [ ] **Step 1: Document sharding in the README**

Insert a `## Sharding across CI jobs` section before `## Contract Validation` (currently line 270):

````markdown
## Sharding across CI jobs

A single run walks the whole suite in one browser. `--shard` splits it across
parallel CI jobs instead.

```bash
npx twd-cli run --shard 2/4     # "I am job 2 of 4"
npx twd-cli merge .twd/shards   # join the reports back together
```

The `4` is how many jobs you are running, **not** how many tests exist. You never
need to know the test count: each shard boots its own browser, discovers the whole
suite exactly as a normal run does, and keeps every 4th test. Add tests and the
same 4 jobs just split more of them.

Each shard writes `run.json` and `coverage.json` to `./.twd/run` (change it with
`--report-dir`). `merge` reads the downloaded shard directories, combines the test
results, coverage and contract validation, prints one summary, and exits non-zero
if anything failed anywhere.

```yaml
jobs:
  test:
    strategy:
      fail-fast: false                        # or one red shard cancels the rest
      matrix:
        shard: [1, 2, 3, 4]
    steps:
      # ...checkout, npm ci, chrome, dev server...
      - run: npx twd-cli run --shard ${{ matrix.shard }}/4
      - uses: actions/upload-artifact@v4
        if: always()                          # a red shard must still upload
        with:
          name: twd-run-${{ matrix.shard }}
          path: .twd/run

  merge:
    needs: [test]
    if: ${{ !cancelled() }}                   # runs even though a shard went red
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - uses: actions/download-artifact@v4
        with:
          pattern: twd-run-*
          path: .twd/shards
      - run: npx twd-cli merge .twd/shards
```

Those three conditions are easy to miss and each one breaks the run:
`fail-fast: false` stops a red shard cancelling its siblings, `if: always()` on
upload keeps a red shard's report, and `if: ${{ !cancelled() }}` on merge lets the
summary print at all.

### Notes

- **Coverage.** Each shard writes its own `coverage.json`; `merge` combines them
  into `.nyc_output/out.json` — but only when the whole run is green, matching how
  a single run behaves. `merge` reports how many shards contributed.
- **Missing shards are an error.** If a shard job dies before uploading, `merge`
  refuses and names the gap rather than silently reporting 3 of 4 shards as a
  complete green run.
- **Tests must register identically in every job.** Each shard fingerprints the
  test list it discovered and `merge` verifies they match. Registering tests
  conditionally — behind a feature flag, a date, `Math.random()` — makes the
  fingerprints diverge and `merge` will say so.
- **`maxFailures` is per shard.** Four shards at the default of 10 can reach 40
  failures between them before all four bail.
- **`--test` and `--shard` compose:** filters resolve first, then the filtered list
  is sharded. As with any filtered run, coverage is skipped.
- **Recording** produces one clip per shard; they are not concatenated.
````

- [ ] **Step 2: Add the CHANGELOG entry**

Prepend to `CHANGELOG.md`, matching the existing `## <small>version (date)</small>` format:

```markdown
## <small>1.5.0-beta.0 (2026-08-19)</small>

* feat(shard): `--shard <i>/<n>` runs one slice of the suite so a run can be split across parallel CI jobs. Each shard discovers the whole suite itself and takes every nth test, so the test count never has to be known in advance
* feat(shard): a sharded run writes `run.json` and `coverage.json` to `./.twd/run` (`--report-dir` to change it) — the first machine-readable output twd-cli has had
* feat(merge): `npx twd-cli merge <dir>` joins shard reports into one report covering test results, coverage and contract validation, prints a single summary with a per-shard breakdown, and owns the exit code
* feat(merge): a missing shard report is an error naming the gap, not a silently incomplete report. Shards also fingerprint the test list they discovered, so shards that saw different test sets refuse to merge
* note: no behavior change without `--shard`. A plain run writes the same files, prints the same output, and exits the same way as 1.4.0

Sharding needs three things right in the workflow: `fail-fast: false` on the
matrix, `if: always()` on the shard's artifact upload, and
`if: ${{ !cancelled() }}` on the merge job. See "Sharding across CI jobs" in the
README.

This is a prerelease, published under the `beta` dist-tag:
`npm install twd-cli@beta`.
```

- [ ] **Step 3: Bump the version**

```bash
npm pkg set version=1.5.0-beta.0
node -p "require('./package.json').version"
```

Expected: `1.5.0-beta.0`

- [ ] **Step 4: Regenerate the lockfile**

```bash
npm run lock:linux
```

`package-lock.json` carries the version in **two** places — the top-level
`version` and `packages[""].version`. Confirm both moved:

```bash
node -e "
  const lock = require('./package-lock.json');
  const root = lock.packages[''].version;
  console.log('top-level:', lock.version, '| packages[\"\"]:', root);
  if (lock.version !== '1.5.0-beta.0' || root !== '1.5.0-beta.0') {
    throw new Error('lockfile version fields disagree with package.json');
  }
"
```

- [ ] **Step 5: Verify the package contents**

```bash
npm pack --dry-run
```

Expected: `bin/`, `src/` (including the five new modules), `README.md`, `LICENSE`. No `tests/`, no `test-example-app/`, no `.twd/`.

- [ ] **Step 6: Run the full suite one last time**

```bash
npm run test:ci
```

Expected: PASS with no coverage regression on `src/**`.

- [ ] **Step 7: Commit and push**

```bash
git add README.md CHANGELOG.md package.json package-lock.json
git commit -m "chore(release): 1.5.0-beta.0"
git push
```

- [ ] **Step 8: Hand back for the release**

The version bump normally happens on `main`, but it lives on this branch by
explicit request so the beta can be tested before merging. Do **not** create the
GitHub Release from this branch. Report to the user that the branch is ready, and
that publishing means:

1. Merge `feat/shardable-run-artifacts` into `main`.
2. Create a GitHub Release tagged `v1.5.0-beta.0`, **marked as a prerelease**.
3. `publish.yml` sees `prerelease == true` and publishes with `--tag beta`, so
   `npm install twd-cli` keeps resolving to 1.4.0.

---

## Verification Checklist

Run after all tasks are complete.

- [ ] `npm run test:ci` passes.
- [ ] `node ./bin/twd-cli.js` prints help including `--shard`, `--report-dir` and `merge`.
- [ ] `node ./bin/twd-cli.js merge` exits 1 with the usage message.
- [ ] `node ./bin/twd-cli.js run --shard 5/4` exits 1 with `Invalid --shard`.
- [ ] In `test-example-app` with a dev server running: `node ../bin/twd-cli.js run --shard 1/2` then `--shard 2/2` (moving `.twd/run` to `.twd/shards/a` and `.twd/shards/b` between runs), then `node ../bin/twd-cli.js merge .twd/shards` prints a `Shards: 1 ✓… | 2 ✓…` line and a test count equal to a full unsharded run.
- [ ] Deleting one shard directory and re-running `merge` errors with `Missing shard report(s)`.
- [ ] `node ../bin/twd-cli.js run` with no flags produces byte-identical output to 1.4.0 (`git stash` the branch and compare).
- [ ] CI green on all five jobs.
