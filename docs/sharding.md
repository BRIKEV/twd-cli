# Sharding across CI jobs

> **Beta.** Sharding is new and marked beta on purpose. It is strictly additive —
> a run without `--shard` behaves exactly as it did before, writes the same
> files, and exits the same way — so enabling it cannot affect your existing
> pipeline. What may still change is **how tests are assigned to shards**: today
> each shard takes every nth test from the discovered list, and a future release
> is likely to group by top-level `describe` instead, so a suite always stays in
> one shard. Do not build anything that depends on *which* tests land in a given
> shard. Everything else — the flags, the report files, `merge`'s output and exit
> code — is stable.

A single run walks the whole suite in one browser. Sharding splits it across
parallel CI jobs instead, then joins the results back into one report.

```bash
npx twd-cli run --shard 2/4     # "I am job 2 of 4"
npx twd-cli merge .twd/shards   # join the reports, decide the exit code
```

The `4` is how many jobs you are running, **not** how many tests exist. You never
need to know the test count: each shard boots its own browser, discovers the whole
suite exactly as a normal run does, and keeps every 4th test. Add tests and the
same 4 jobs just split more of them.

Each shard writes `run.json` and `coverage.json` to `./.twd/run` (change it with
`--report-dir`). `merge` reads the downloaded shard directories, combines test
results, coverage and contract validation, prints one summary, and exits non-zero
if anything failed anywhere.

## A complete workflow

This runs as-is. The bundled action installs Chrome, runs the shard, and uploads
its report under the name `merge` expects.

```yaml
name: TWD tests (sharded)

on:
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      # Without this, the first red shard cancels its siblings and the merge job
      # sees gaps it cannot tell apart from a shard that crashed.
      fail-fast: false
      matrix:
        shard: [1, 2, 3, 4]

    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm

      - run: npm ci

      - name: Start the dev server
        run: |
          nohup npm run dev > dev.log 2>&1 &
          npx wait-on http://localhost:5173 --timeout 60000

      - name: Run this shard
        uses: BRIKEV/twd-cli/.github/actions/run@main
        with:
          shard: ${{ matrix.shard }}/4

  merge:
    runs-on: ubuntu-latest
    needs: [test]
    # Runs even though a shard job may have exited 1. Without this a red shard
    # short-circuits the workflow and the merged summary never prints.
    if: ${{ !cancelled() }}

    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm

      - run: npm ci

      - uses: actions/download-artifact@v4
        with:
          pattern: twd-run-*
          path: .twd/shards

      - name: Merge the shard reports
        run: npx twd-cli merge .twd/shards
```

`merge` owns the final exit code: it fails if any test failed in any shard, if a
contract was violated in `error` mode, or if a shard report is missing entirely.

### Posting the contract report

A sharded run deliberately writes no contract markdown per shard — each would
overwrite the others with a fraction of the mocks — so `merge` writes it, and the
PR comment belongs in the merge job:

```yaml
  merge:
    permissions:
      contents: read
      pull-requests: write
    steps:
      # ...as above, through "Merge the shard reports"...

      - name: Post contract report to PR
        if: github.event_name == 'pull_request' && hashFiles('.twd/contract-report.md') != ''
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh pr comment "${{ github.event.pull_request.number }}" --body-file .twd/contract-report.md
```

## Without the bundled action

If you drive the CLI directly, you own the two steps the action was doing for
you — installing Chrome, and uploading the report with `if: always()`:

```yaml
      - run: npx puppeteer browsers install chrome
      - run: npx twd-cli run --shard ${{ matrix.shard }}/4
      - uses: actions/upload-artifact@v4
        # A red shard must still upload, or merge cannot tell "this shard failed"
        # from "this shard never ran".
        if: always()
        with:
          name: twd-run-${{ matrix.shard }}
          path: .twd/run
          if-no-files-found: error
```

## The three conditions that matter

Each of these breaks a sharded run in a different way, and all three are easy to
leave out:

| Condition | Where | What breaks without it |
|---|---|---|
| `fail-fast: false` | the shard matrix | the first red shard cancels its siblings, and `merge` reports their reports as missing |
| `if: always()` | the shard's artifact upload | a red shard uploads nothing, so `merge` cannot distinguish failure from a crash |
| `if: ${{ !cancelled() }}` | the merge job | a red shard short-circuits the workflow and the merged summary never prints |

## When sharding pays

Sharding trades fixed per-job setup for parallel test execution, so it only wins
once test time dominates. With per-job overhead `V`, total test time `T`, and a
merge job costing `M`, the wall clock goes from `V + T` to `V + T/N + M`. So `N`
shards help only when:

```
M < T (1 - 1/N)        →  for two shards, roughly T > 2M
```

Measured on a real suite of 256 browser tests, where `V` was ~115s and the merge
job ~126s (89s of which was a SonarCloud scan):

| Shards | Wall clock | Runner time |
|---|---|---|
| 1 | 12.6 min | baseline |
| 2 | ~8.1 min | +15% |
| 4 | 6.5 min | +47% |

Two things to take from that. Wall clock has a floor of `V + M` no matter how far
you shard, so the returns fall off quickly — past four shards you pay a lot for
seconds. And sharding always costs *more* total compute than it saves in latency,
because every shard repeats `V`. If you are billed for runner minutes, or your
runner concurrency is contended, prefer the smallest `N` that gets you under your
target.

On a short suite sharding is simply slower: this project's own 71-test suite goes
from 25s in one job to 41s across two plus a merge.

## Caveats

- **Coverage.** Each shard writes its own `coverage.json`; `merge` combines them
  into `.nyc_output/out.json` — but only when the whole run is green, matching how
  a single run behaves. `merge` reports how many shards contributed.
- **Missing shards are an error.** If a shard job dies before uploading, `merge`
  refuses and names the gap rather than silently reporting 3 of 4 shards as a
  complete green run.
- **Tests must register identically in every job.** Each shard fingerprints the
  ordered list of `"suite > test"` paths it discovered and `merge` verifies they
  match. Registering tests conditionally — behind a feature flag, a date,
  `Math.random()` — makes the fingerprints diverge and `merge` will say so.
  (Paths rather than internal test ids: `twd-js` assigns those at registration
  time and they differ on every page load, so each shard's browser sees its own.)
- **`maxFailures` is per shard.** Four shards at the default of 10 can reach 40
  failures between them before all four bail.
- **`--test` and `--shard` compose:** filters resolve first, then the filtered list
  is sharded. As with any filtered run, coverage is skipped.
- **Recording** produces one clip per shard; they are not concatenated.
- **A missing shard leaves no merged report on disk.** `merge` throws before it
  writes `.twd/merged-run.json`, so a CI step that uploads that path with
  `if: always()` will find nothing when a shard is missing. The error message on
  stderr is the diagnosis in that case.
- **`record.filename` collides under sharding.** Only the *derived* recording
  filename is per-shard. If `record.filename` is set explicitly in
  `twd.config.json`, every shard writes to the same video path. Use the derived
  name, or a per-shard `--record-dir`, when recording a sharded run.
- **Assignment may change.** See the beta note at the top: which tests land in
  which shard is not part of the stable contract yet.
