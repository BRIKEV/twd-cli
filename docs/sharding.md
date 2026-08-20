# Sharding across CI jobs

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
      - run: npx twd-cli merge .twd/shards
```

Those three conditions are easy to miss and each one breaks the run:
`fail-fast: false` stops a red shard cancelling its siblings, `if: always()` on
upload keeps a red shard's report, and `if: ${{ !cancelled() }}` on merge lets the
summary print at all.

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

## Using the GitHub Action

The bundled action takes a `shard` input and handles the artifact upload, which
is the part that is easiest to get wrong:

```yaml
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2]
    steps:
      # ...checkout, npm ci, dev server...
      - uses: BRIKEV/twd-cli/.github/actions/run@main
        with:
          shard: ${{ matrix.shard }}/2

  merge:
    needs: [test]
    if: ${{ !cancelled() }}
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

The action uploads each shard's report as `twd-run-<index>` with `if: always()`,
which is the layout `download-artifact` + `merge` expect. It also skips the
contract PR comment when `shard` is set, since a sharded run writes no contract
markdown per shard — post it from the merge job instead.

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
