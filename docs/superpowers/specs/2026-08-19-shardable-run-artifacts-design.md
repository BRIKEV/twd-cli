# Shardable run artifacts and a merge command - Design

Date: 2026-08-19
Status: Ready to plan
Repo: `twd-cli` only. No twd-js changes.

## Problem

A twd-cli run is a single Puppeteer process walking the whole suite. On a large
suite that is the slowest step in CI, and there is no way to divide it.

Running Puppeteer concurrently *inside* one job was tried and abandoned: several
browsers contending for one runner's CPU made runs flaky enough to be useless.
Separate CI jobs avoid that entirely, because each job gets its own runner, its
own dev server, and its own browser. Nothing is shared, so nothing contends.

What blocks that today is not concurrency. It is that a run has no
machine-readable output. Every structured value `runTests()` builds is printed
and discarded; the function returns a bare boolean (`src/index.js:359`). Four
parallel jobs would produce four consoles and nothing joinable.

## Scope

In scope: splitting a run across jobs, writing each job's results to disk, and
merging those results back into one report covering test results, coverage, and
contract validation.

Out of scope: concatenating per-shard videos (each shard records its own clip;
the report lists them). Timing-aware shard balancing (needs a persisted timing
artifact — revisit if count-based balance proves uneven). Dynamic matrix sizing
and a `twd-cli list` command (a fixed matrix needs neither; see "The shard
model"). Reducing contract-report noise, which is its own tracked concern.

This spec also does not reopen the AI-friendly-output decision that there is one
console format and no `--reporter` flag
(`docs/superpowers/specs/2026-07-06-ai-friendly-output-design.md`). The report
JSON is an artifact for merging, not an alternative console reporter. Text
output stays the default and is unchanged.

## What already exists

The data is already the right shape; only the output layer is missing.

| Concern | Exists today as | Merge story |
|---|---|---|
| Test results | `testStatus` = `[{id, status, error?, retryAttempt?}]` plus `handlers` (`src/index.js:281`, `:210`) | Concat. Each test runs in exactly one shard, so ids never collide. `handlers` is identical in every shard. |
| Coverage | `.nyc_output/out.json`, raw Istanbul JSON (`src/index.js:338`) | Natively mergeable via `istanbul-lib-coverage`. No new merge logic. |
| Contracts | `validateMocks()` returns `{results, skipped}`, plain objects (`src/contracts.js:109`) | Concat. Occurrence counters are per-process but keyed by `testId`, so no cross-shard collision. |
| Summary | Built by `formatRunComplete`, then discarded | Recomputed from merged test results. |

Sharding primitives exist too: `orderedTestIds()` in `src/testOrder.js` already
yields a deterministic pre-order id list.

## The shard model

`--shard 2/4` means "I am job 2 of 4 parallel jobs". The `4` is the job count,
chosen by the workflow author. **The test count is never needed in advance.**

Each shard enumerates the suite itself — `src/index.js:125` already reads
`window.__TWD_STATE__.handlers` on every run — then keeps every Nth id:

```js
// src/shard.js
export function selectShardIds(ids, index, total) {
  return ids.filter((_, i) => i % total === index - 1);
}
```

```
120 tests discovered (indices 0..119), identical in all 4 jobs
shard 1/4 -> i % 4 === 0 -> 0, 4,  8, ...  (30 tests)
shard 2/4 -> i % 4 === 1 -> 1, 5,  9, ...  (30 tests)
shard 3/4 -> i % 4 === 2 -> 2, 6, 10, ...  (30 tests)
shard 4/4 -> i % 4 === 3 -> 3, 7, 11, ...  (30 tests)
```

Round-robin rather than contiguous slicing: it balances better when adjacent
tests have similar cost, at the price of suite locality. Nothing in twd-js
requires a suite to run contiguously, so locality buys nothing here.

Consequences worth stating, because they are what make a fixed matrix safe:

- The suite can grow without a YAML edit. 200 tests split across the same 4
  jobs; they just take longer.
- **An empty shard is legal.** 3 tests across 4 shards leaves shard 4 with
  nothing. It writes a valid report with `tests: []`. Not an error.

## Report schema

The load-bearing decision: **a merged report is shape-identical to a
single-shard report.** `shards` is always an array — one entry for a single run,
N after merging. This makes merge associative, lets every formatter work on
both, and makes a normal run the N=1 case with no second code path.

```jsonc
{
  "schemaVersion": 1,
  "shards": [
    { "index": 2, "total": 4,
      "startedAt": "2026-08-19T10:00:00.000Z",
      "endedAt":   "2026-08-19T10:00:12.345Z",
      "durationMs": 12345,
      "executed": 30, "notRun": 0, "failed": 0, "stoppedEarly": false,
      "coverageFile": "coverage.json",
      "recording": { "file": "login.mp4", "bytes": 481920 } }
  ],
  "discovery": { "totalTests": 120, "fingerprint": "sha256:abc123..." },
  "selection": { "filters": [] },
  "handlers": [ { "id": "...", "name": "...", "parent": "...", "type": "test" } ],
  "tests":    [ { "id": "...", "status": "pass", "retryAttempt": 2 } ],
  "contracts": { "configured": true, "partial": false, "results": [], "skipped": [] }
}
```

`handlers` and `tests` reuse the exact shapes already flowing through
`src/index.js:128` and `:226`, so `buildTestPath`, `formatRunComplete` and
`generateContractMarkdown` need no data massaging. `contracts` is
`validateMocks()`'s return value verbatim plus two flags.

Each shard descriptor carries its own `failed` count. Merged `tests` do not
record which shard ran them, so without it the per-shard breakdown line
(`Shards: 1 ✓30 | 2 ✗30 | ...`) could not be rendered — and knowing *which*
shard went red is most of that line's value.

`selection.filters` holds the `--test` values. Filters and shards compose:
filters resolve first, then the filtered list is sharded. There is no companion
`mode` field — a report only exists under `--shard`, so it would be a constant.

Coverage is **referenced, not embedded** — `coverageFile` names a sibling file.
This keeps `run.json` readable by eye and keeps coverage in stock Istanbul
format so `nyc` tooling works on it untouched. A coverage blob is routinely
several megabytes; embedding it would make every report unreadable.

Duration is ambiguous once jobs run in parallel, so two figures are reported:
wall-clock span (`max(endedAt) - min(startedAt)`), which is what the developer
waited, and total compute (sum of `durationMs`), which is what was paid for. For
a single shard they are equal. Both are **derived from `shards[]` at render
time**, not stored as fields — the per-shard timestamps are sufficient, and
storing derived totals would let them drift out of agreement under merge.

### `discovery.fingerprint` is the safety net

The fingerprint is a hash of `{ orderedIds: <all registered test ids in order>,
filters: <sorted --test values> }`.

Round-robin sharding is correct only if every job enumerates an identical test
set. That silently breaks if the app registers tests conditionally — a feature
flag, a date, `Math.random()` — or if two shard jobs somehow build different
code. Without the fingerprint that manifests as tests quietly never running and
a green build. With it, merge refuses and explains why. This is the part of the
design least safe to drop.

## Hard constraint: no change to non-sharded runs

A run without `--shard` must behave exactly as 1.4.0 does — same console output,
same files written, same exit code. The feature is strictly additive, and every
behavior change below is gated on sharding being active. This is what makes the
work safe to ship as a beta that existing users can install without reading a
migration note.

Two changes needed scoping to honor this, and both reduce to one extra term in an
existing conditional:

| Today (`src/index.js`) | Becomes |
|---|---|
| `config.coverage && !hasFailures && !selectedIds` (`:325`) | `config.coverage && filters.length === 0 && (sharded \|\| !hasFailures)` |
| `!stoppedEarly && config.contracts?.length` (`:296`) | `(sharded \|\| !stoppedEarly) && config.contracts?.length` |

With `sharded === false` each reduces to today's expression exactly — the
`!selectedIds` guard and `filters.length === 0` are the same predicate, since
`selectedIds` is only set by `--test` on a non-sharded run.

The remaining additions cannot affect an existing run by construction: new flags
are inert when absent, report writing happens only under `--shard`, `merge` is a
new subcommand, and `formatRunComplete`'s new optional `shards` param changes
output only when more than one shard is present.

## Coverage: the gate moves up a level

Today coverage is gated twice (`src/index.js:325`):

```js
if (config.coverage && !hasFailures && !selectedIds) {
```

Both gates change.

`!selectedIds` exists so a `--test` filter cannot produce a misleading
project-wide number. A shard slice is not a user filter, so the rule becomes:
**collect coverage unless `selection.filters` is non-empty.** A filtered run
still skips, sharded or not.

`!hasFailures` is the more interesting one, and per the constraint above it is
relaxed **only when sharded**. `hasFailures` is per shard, so
applying it at shard level gives the worst outcome: shards 1, 2 and 4 write
coverage, shard 3 goes red and writes none, and merge emits a report that looks
complete while missing a quarter of the code paths. Silent understatement is
worse than absence.

The same policy therefore applies one level up:

- **Shards always write `coverage.json`.** No shard-level failure gate, so a
  shard's file is never mysteriously absent.
- **Merge writes `.nyc_output/out.json` only when the merged run is green.**

Net policy is unchanged — a red run yields no coverage — but under sharding it is
keyed on the true global result rather than on one shard's.

Where coverage lands depends on whether reporting is active, and the two paths
are mutually exclusive on purpose:

- **Without `--shard`** (today's normal run): `.nyc_output/out.json`, written
  exactly as now, including still being skipped on failure. No change at all.
- **With `--shard`**: `<report-dir>/coverage.json` only. It is
  deliberately *not* also written to `.nyc_output/out.json`, because one shard's
  partial coverage sitting at the path `nyc` reads by default would masquerade as
  the whole run's. Under sharding, `.nyc_output/out.json` is written by `merge`
  and by nothing else.

Since a red run still exits 1, no coverage gate can be fooled by the relaxed
failure gate on the sharded path.

## maxFailures stays per shard

Cross-job coordination is impossible without an external store, so each shard
gets the full `maxFailures` budget (default 10) independently. Four shards can
therefore accumulate up to 40 failures before all four bail.

This is documented, not fixed, and the reason it is acceptable is that the
budget exists to stop CI burning time on a fundamentally broken app — with the
suite already divided N ways, each shard reaches its own limit fast enough that
the extra wasted time is not noticeable. Dividing the budget instead
(`ceil(maxFailures / total)`) was considered and rejected: a shard stopping at 3
failures is hard to explain from its own log, and it makes the CLI depend on the
shard count to compute a threshold.

A bailing **shard** no longer skips contract validation. Today `stoppedEarly`
skips it outright (`src/index.js:296`, `:317`); under sharding it instead
validates what it collected and sets `contracts.partial: true`, so merge can
report exactly what is missing rather than silently dropping a quarter of the
mocks. The console report gains a partial banner in place of the skip message.
A non-sharded early-stopped run keeps skipping validation, as today.

## `twd-cli merge <dir>`

Discovery globs `<dir>/*/run.json`, which is exactly `download-artifact`'s
layout (one directory per artifact name). `<dir>/run.json` is also accepted for
the degenerate single-report case.

Validation runs before anything is combined. All of these are fatal:

- at least one report found
- all `schemaVersion` equal (otherwise: mismatched twd-cli versions across jobs)
- all `discovery.fingerprint` equal
- all `shards[].total` equal, and `shards[].index` covers `1..total` exactly —
  no gaps, no duplicates
- no test id appears in two reports

Combining is then mechanical. `tests`, `contracts.results` and
`contracts.skipped` concat. `shards` concats sorted by index. `handlers` and
`discovery` come from the first report, already proven identical.
`contracts.partial` is the OR across shards. One cross-check: `sum(executed) +
sum(notRun)` must equal `discovery.totalTests`; a mismatch warns, since it
indicates a shard-math bug rather than user error.

Output goes three places:

1. Merged report to `--out` (default `.twd/merged-run.json`).
2. Merged coverage to `.nyc_output/out.json`, only when the merged run is green.
3. Markdown to `contractReportPath` when configured — so the existing PR-comment
   step at `.github/actions/run/action.yml:37` keeps working unchanged.

**Merge owns the exit code**: 1 on any test failure, any `error`-mode contract
violation, or any validation failure above. Otherwise 0.

```
--- Run complete ---
  Passed: 114 | Failed: 6 | Skipped: 0
  Duration: 38.2s wall (2m14s compute across 4 shards)

  Shards: 1 ✓30 | 2 ✗30 | 3 ✓30 | 4 ✓30

  Failed tests (6):
    × Checkout > applies discount code
      Expected 90 but got 100 (at http://localhost:5173/cart)
```

## Modules

| Module | Responsibility |
|---|---|
| `src/shard.js` | `selectShardIds(ids, index, total)` |
| `src/runReport.js` | `buildRunReport({...})` -> plain object. No I/O. |
| `src/reportFiles.js` | Write `run.json` + `coverage.json`; discover and read shard dirs |
| `src/mergeReports.js` | `mergeRunReports([reports])` -> same shape, plus the validation above |
| `src/mergeCoverage.js` | `istanbul-lib-coverage` `CoverageMap.merge()` |

Existing files: `parseArgs.js` learns the new flags; `index.js` slices ids and
calls `buildRunReport` + `writeRunReport` instead of discarding its locals;
`bin/twd-cli.js` gains the `merge` command; `testSummary.js` gains an optional
`shards` param that prints the per-shard breakdown when there is more than one.

`formatRunComplete`'s loose-argument signature is kept as-is and called with
fields destructured from the report, rather than being rewritten to take a
report object. Less churn, and the formatter stays dumb.

## CLI flags

```
npx twd-cli run --shard 2/4        # a shard; writes a report
npx twd-cli run --shard 1/1        # the non-sharded case: one shard, one report
npx twd-cli run --report-dir <p>   # default .twd/run
npx twd-cli merge <dir>
npx twd-cli merge <dir> --out <p>  # default .twd/merged-run.json
```

Report writing is driven entirely by `--shard`, so no existing run starts
littering the working tree. There is deliberately no separate `--report` flag:
a shard that writes nothing is useless, so the report is a property of sharding,
and `--shard 1/1` already expresses "one shard, write its report". A dedicated
`--report` would add a second flag, an implication rule to document and test,
and a third code path in `parseArgs` for something no consumer needs yet. It is
a one-line addition later if one turns up.

Each flag accepts both `--flag value` and `--flag=value`, matching the existing
`readValue` helper in `src/parseArgs.js`.

### One deliberate divergence: `--shard` validates strictly

`src/parseArgs.js:28` silently ignores a malformed `--record-speed`. `--shard`
must not follow that precedent. `--shard 5/4`, `--shard 0/4` and `--shard abc`
would each silently run zero tests and exit 0 — a green build that tested
nothing. Invalid shard specs error and exit 1.

## Failure modes

| Situation | Behavior |
|---|---|
| Shard crashed before upload, artifact missing | error, names the missing index — never a silent 3-of-4 green |
| Shard uploaded but bailed at `maxFailures` | merged report carries its `notRun`, contracts flagged `partial`, exit driven by the real failures |
| Shards saw different test sets | error citing conditional registration or mismatched code |
| Same test id in two shards | error — shard math bug |
| Fewer tests than shards | valid: empty shard writes `tests: []` |
| `--shard 5/4`, `0/4`, `abc` | parse error, exit 1 |
| A shard's `coverage.json` absent | that shard does not contribute; merge states the contributor count |
| `merge` on empty or missing dir | error, exit 1 |
| `--shard` and `--test` together | compose; filters feed the fingerprint so differently-filtered shards cannot merge; coverage skipped |

## CI shape

```yaml
jobs:
  test:
    strategy:
      fail-fast: false                        # or one red shard cancels the rest
      matrix: { shard: [1, 2, 3, 4] }
    steps:
      - ...checkout, npm ci, chrome, dev server...
      - run: npx twd-cli run --shard ${{ matrix.shard }}/4
      - uses: actions/upload-artifact
        if: always()                          # a red shard must still upload
        with:
          name: twd-run-${{ matrix.shard }}
          path: .twd/run

  merge:
    needs: [test]
    if: ${{ !cancelled() }}                   # runs even though a shard went red
    steps:
      - uses: actions/checkout@v5              # merge reads twd.config.json
      - uses: actions/setup-node@v5
        with: { node-version: 24, cache: npm }
      - run: npm ci                            # merge needs twd-cli installed
      - uses: actions/download-artifact
        with: { pattern: twd-run-*, path: .twd/shards }
      - run: npx twd-cli merge .twd/shards    # owns the final exit code
```

Three easy-to-miss details, all load-bearing:

- `fail-fast: false`, or the first red shard cancels its siblings and merge sees
  gaps.
- `if: always()` on upload, or a red shard uploads nothing and merge cannot
  distinguish "shard failed" from "shard never ran".
- `if: ${{ !cancelled() }}` on merge, or a red shard short-circuits the workflow
  and the merged summary — the entire point — is never printed.

Action versions are written as `@v5` above for readability; the real workflow
SHA-pins them, matching `.github/workflows/e2e.yml`.

## Dependency change

`istanbul-lib-coverage` is currently present only transitively, via the
`@vitest/coverage-v8` devDependency. It gets promoted to a real `dependency`.
Small and battle-tested, but it means running `npm run lock:linux` afterwards so
the wasm32-wasi transitive deps stay correct for Linux CI.

## Release

Ships as a prerelease so it can be exercised against a real suite before it
becomes the default install. `package.json` goes to `1.5.0-beta.0`, and the
GitHub Release is marked as a prerelease — `publish.yml:27` already routes
prereleases to the `beta` dist-tag, so `npm install twd-cli` keeps resolving to
1.4.0 and testers opt in with `npm install twd-cli@beta`. No workflow change.

Per the repo's release process the version bump is its own commit carrying
`package.json`, the lockfile regenerated with `npm run lock:linux`, and a
hand-written CHANGELOG entry. The `conventional-changelog` script is not used.

## Testing

Existing constraints hold: no test may require a real browser or a real ffmpeg
binary, and `vi.mock('fs')` auto-mocks `statSync` to `undefined`.

New files: `tests/shard.test.js`, `tests/runReport.test.js`,
`tests/reportFiles.test.js`, `tests/mergeReports.test.js`,
`tests/mergeCoverage.test.js`.

Two of the cases are properties rather than examples, and they are what make the
whole scheme trustworthy:

- **Partition**: the union of all shards equals the input list, with every id
  appearing exactly once.
- **Associativity**: `merge([merge([a, b]), c])` deep-equals `merge([a, b, c])`.

If both hold, sharding cannot silently lose or double-run a test.

Alongside them: gap detection, fingerprint mismatch, duplicate ids, empty
shards, coverage counts summing across shards, `--shard` parse validation, and
extensions to `tests/runTests.test.js` asserting the shard slice reaches
`runByIds`, the report is written, and **coverage is written despite failures**
(the gate change).

The constraint above needs its own explicit coverage, not just inference: tests
asserting that with no `--shard` flag, a failing run still writes **no**
coverage file and an early-stopped run still **skips** contract validation. Those
are the two conditionals that were touched, so they are the two that could
silently regress an existing user.

Unit tests cannot exercise the real Actions plumbing, so
`.github/workflows/e2e.yml` gains a 2-shard-plus-merge run against
`test-example-app`. That is what would catch a missing `if: always()` or a wrong
artifact path.

## Value

Wall-clock CI time divides by the shard count without the flakiness that killed
in-process parallelism, because separate jobs share no CPU, no dev server, and
no browser.

Secondarily, the run report is the machine-readable output twd-cli has never
had. Merging is its first consumer; agent-driven TDD loops reading results
without parsing console text are an obvious second.
