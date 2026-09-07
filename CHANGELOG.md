## <small>1.7.0 (2026-09-07)</small>

* feat(run): `--changed-since <ref>` runs only the tests the current branch added or changed, worked out from git. It replaces the diff-and-grep script every consumer was hand-rolling — 82 lines in `twd-vue-example`, plus a step to count the results and skip when empty, plus a bash loop building `--test` arguments (#25)
* feat(run): titles come from **added lines only**, in `*.twd.test.*` files, falling back to every title in a changed file when the diff moved no `it()` line at all. `it()` and `it.only()` are selected, `it.skip()` and `xit()` never are — a test that does not run cannot be recorded. Uncommitted and untracked test files count too
* feat(run): a branch that changed no tests prints one line and **exits 0**. An empty result is a normal CI outcome, not a failure, unlike `--test`, which is an assertion you typed and still exits 1 when it matches nothing. This is decided before the browser launches, so such a run needs no dev server at all
* fix(record): a dead ffmpeg no longer hangs the run. Puppeteer's `stop()` waits on a `close` event that has already fired when ffmpeg exited early, so the await never returned — it cost an entire CI job on a suite whose tests had all passed. The encoder's death is now detected from the recorder stream, the frame pipeline is aborted (which is what ends the endless `ffmpeg failed to write` output), and the stop is bounded (#24)
* fix(record): ffmpeg's own stderr is finally surfaced. Puppeteer routes it to a debug channel and nowhere else, so the only previous way to learn why an encode failed was to point `record.ffmpegPath` at a wrapper script that tees it (#24)
* fix(record): the pre-flight now checks what recording actually needs rather than that ffmpeg merely exists. `ffmpeg -h muxer=mp4` must list every movflag Puppeteer will pass. A version floor would be a moving target — the flags are Puppeteer's — and one written from a single measurement was already wrong on the second (#24)
* fix(record): mp4 output is converted to H.264 / `yuv420p` after the run, so it opens in QuickTime, Preview and every browser. The screencast produces VP9 with `pix_fmt=gbrp`, which is valid, decodable, and openable in neither — a successful recording that looks like a failure. Measured on a real capture it is also about a quarter of the size (#24)
* fix(record): `--record-pace 0` works. The parser guarded on `> 0`, so `0` was dropped and the run silently stayed at the 300ms default, while the same value in `twd.config.json` worked. The documentation was right and the parser was the odd one out (#27)
* fix(parse): a value starting with `--` is no longer consumed as a flag's value. `--test --record` used to take `--record` as the filter text and swallow the flag (#27)
* feat(record): the default recording viewport is `1280x1600`, up from `1280x720` (#26)
* feat(actions): a `record` composite action, sibling to `run`. It installs a known-good ffmpeg, records, and uploads the clips, so a consumer's whole recording workflow is one step. Workflow policy — the trigger, the PR comment, the dev server — stays with the caller, exactly as it does for `run` (#28)
* note: **recording mp4 now requires ffmpeg 8 or newer, and says so before the browser launches.** Puppeteer passes `-movflags hybrid_fragmented`, which arrived after ffmpeg 7: measured, 6.1.1 (ubuntu-24.04) no, 7.0.2 (the obvious static build) no, 8.1.2 yes. This is not a new limitation — those versions never produced a video — but it now fails in one actionable line instead of hanging the job. `webm` and `gif` pass no movflags and are unaffected
* note: **a failed recording now fails the run**, exit 1, even when every test passed. You asked for an artifact and did not get one; a silent pass sends the next person looking for a video that is not there. A 0-byte output stays a warning, since a suite that never repaints legitimately records nothing
* note: **behaviour change on recorded output.** Clips are taller and are now H.264 rather than VP9. The viewport decides what the video contains — Puppeteer captures exactly it, with no scrolling and no letterboxing — and at 720 a real recording cut the page above the list the tests asserted on. `record.viewport` still wins when you set it

Recording changed more in this release than anything else, and two of those
changes can turn a run red that was previously green: an ffmpeg older than 8 is
now rejected up front, and a recording that fails takes the run with it. Both
replace a silent failure — a hung job, or a clip that documented nothing — so
the fix is to install ffmpeg 8, not to look for a flag that restores the old
behaviour. There isn't one.

`--changed-since` is the part worth adopting even if you never record: it is a
filter, and `--record` is optional.

Nothing here needs a newer `twd-js`. The pacing hook still wants 1.9.0 or newer
and the layout snapshot flags still want 1.10.0, both unchanged from 1.6.0.

## <small>1.6.0 (2026-09-06)</small>

* feat(snapshots): `--update-snapshots` and `--ci` drive `twd.matchLayout` headlessly. `matchLayout` is off in the browser sidebar on purpose, because the sidebar resizes the page and a developer's window is an arbitrary size, so twd-cli is where a layout snapshot is actually decided
* feat(snapshots): the two flags stay separate the way Jest separates them, because they close two different holes. `--update-snapshots` rewrites references that already exist; `--ci` forbids *creating* one, so a brand new test cannot write its own baseline on the first CI run and pass forever without anyone noticing
* feat(snapshots): a run writes a self-contained `.twd/snapshot-report.html` with every failure capture embedded. In CI the machine that produced the PNGs is gone by the time anyone looks, so this is one file, one artifact, opened in any browser rather than a zip of loose images matched up by filename
* feat(snapshots): captures from earlier runs are cleared before each run. twd-js overwrites a capture on failure but never removes one when that snapshot later passes, so without the sweep a fixed layout keeps its old capture forever and the report shows a failure that no longer exists. Only `*.failed.png` is touched; the committed `.snap` references next to them are not
* feat(diagnostics): a failing test now reports which mock rules never fired, above the error message rather than below, because a twd-js failure message can carry a full accessible-roles dump that would bury it (#20)
* chore(deps): puppeteer 25.10.0 and a clean `npm audit` (#19)
* docs: list the sharding inputs in the action inputs table (#18)
* note: **behaviour change, and it is not opt-in.** `page.setViewport()` now runs on every run, not just when recording. A normal run used to inherit Puppeteer's implicit size. Layout snapshots are only reproducible if the viewport is fixed and explicit, and relying on the implicit default would mean a Puppeteer upgrade could change it and invalidate every committed reference at once, without a word. The default is `1280x800`, `viewport` in `twd.config.json` pins your own, and `record.viewport` still wins while recording
* note: the snapshot flags need **twd-js 1.10.0 or newer**. On an older version there is no `matchLayout` to drive and the flags do nothing

A normal release: `npm install twd-cli` gets it. The *layout snapshot feature* is
the part marked beta, and it needs `twd-js` 1.10.0 or newer to do anything at
all.

Unlike 1.5.0, this one does **not** come with a "no behaviour change unless you
opt in" guarantee. The viewport is now set explicitly on every run, so read that
note above even if you never touch a layout snapshot.

## <small>1.5.0 (2026-08-25)</small>

* feat(shard): `--shard <i>/<n>` runs one slice of the suite so a run can be split across parallel CI jobs. Each shard discovers the whole suite itself and takes every nth test, so the test count never has to be known in advance
* feat(shard): a sharded run writes `run.json` and `coverage.json` to `./.twd/run` (`--report-dir` to change it) — the first machine-readable output twd-cli has had
* feat(merge): `npx twd-cli merge <dir>` joins shard reports into one report covering test results, coverage and contract validation, prints a single summary with a per-shard breakdown, and owns the exit code
* feat(merge): a missing shard report is an error naming the gap, not a silently incomplete report. Shards also fingerprint the test list they discovered, so shards that saw different test sets refuse to merge
* chore(packaging): a `files` allowlist in package.json — the published package is now just `bin/`, `src/`, `README.md`, `CHANGELOG.md` and `LICENSE`. `tests/`, `test-example-app/`, `docs/` and the repo tooling were all being published and no longer are, taking the tarball from ~209 kB to ~33 kB (99 files to 25, ~850 kB to ~101 kB unpacked). Nothing that was importable before has moved
* note: **sharding ships as a beta feature.** It is strictly additive, so a run without `--shard` is unaffected, but which tests land in which shard is not yet a stable contract — a later release is likely to group by top-level `describe` so a suite always stays in one shard
* note: no behavior change without `--shard`. A plain run writes the same files, prints the same output, and exits the same way as 1.4.0

Sharding needs three things right in the workflow: `fail-fast: false` on the
matrix, `if: always()` on the shard's artifact upload, and
`if: ${{ !cancelled() }}` on the merge job. Each one breaks the run differently
if left out. See [docs/sharding.md](docs/sharding.md) for a runnable workflow.

A normal release: `npm install twd-cli` gets it. The *sharding feature* is the
part marked beta — everything else in this version is stable.

## <small>1.4.0 (2026-07-28)</small>

* feat(record): video recording for twd-cli runs (#13) ([94c21e0](https://github.com/BRIKEV/twd-cli/commit/94c21e0)), closes [#13](https://github.com/BRIKEV/twd-cli/issues/13)
* feat: `--record` captures the run to a video via Puppeteer's `page.screencast()`. `--record-dir`, `--record-speed` and a `record` block in `twd.config.json` cover output location, format, viewport, fps and framing
* feat: the TWD sidebar is hidden during capture and the html margins it sets are reset, so the frame is just your app
* feat: one clip per run, named after its content. A single recorded test gets a slug of its `"suite > test"` path, anything else gets `run.<ext>`
* feat(record): drive twd-js command pacing from --record-pace (#15) ([cd9d90c](https://github.com/BRIKEV/twd-cli/commit/cd9d90c)), closes [#15](https://github.com/BRIKEV/twd-cli/issues/15)
* feat: recorded runs are paced at 300ms by default, so `--record` alone produces something watchable. `--record-pace` changes it, `--record-pace 0` disables. Unlike `--record-speed` this costs no frame rate, because the run is paced rather than the video stretched
* fix(record): the last state a test reached is now captured. Chrome only emits a frame on repaint and Puppeteer holds each frame until the next arrives, so without `postRoll` the video ended one or two states early
* feat: add context7 configuration file with URL and public key ([6610302](https://github.com/BRIKEV/twd-cli/commit/6610302))

Recording requires **ffmpeg** on your `PATH`, or `record.ffmpegPath` set. Pacing
additionally requires `twd-js` 1.9.0 or newer; on an older version the run still
records, unpaced, with a warning.

A recorded run sets its own viewport and reflows the app to full width, and
pacing inserts real delays between actions, so a recorded run can pass or fail
differently from a normal one. Treat the video as a demo artifact and keep
running CI unrecorded.

## <small>1.3.1 (2026-07-21)</small>

* feat: fail-fast early bail + durable partial results (#12) ([9b963d2](https://github.com/BRIKEV/twd-cli/commit/9b963d2)), closes [#12](https://github.com/BRIKEV/twd-cli/issues/12)
* feat: `maxFailures` (default `10`) stops the run after that many total failures, prints the results gathered so far, and exits non-zero; set `0` to run every test
* feat: `chunkSize` (default `10`) — tests run in ordered chunks via `runByIds`, so a `protocolTimeout` or crash mid-run prints completed results instead of discarding the whole run
* note: `maxFailures` is on by default — runs now stop after 10 total failures; raise it or set `0` to restore run-everything behavior. Exit codes unchanged

## <small>1.3.0 (2026-07-08)</small>

* feat: AI-friendly run output and actionable error diagnostics (#10) ([0fc410a](https://github.com/BRIKEV/twd-cli/commit/0fc410a)), closes [#10](https://github.com/BRIKEV/twd-cli/issues/10)
* BREAKING (output only): the `Tests: N passed…` line and per-test tree are gone — update log-parsers; exit codes unchanged
* chore: drop `twd-js` dependency (no longer used)
* ci: publish GitHub prereleases under the npm `beta` dist-tag

## <small>1.2.0 (2026-06-26)</small>

* feat: add --test filter flag for targeted test runs (#9) ([795e76e](https://github.com/BRIKEV/twd-cli/commit/795e76e)), closes [#9](https://github.com/BRIKEV/twd-cli/issues/9)
* fix: regenerate lockfile on linux to sync @emnapi to 1.10.0 ([f6c2ced](https://github.com/BRIKEV/twd-cli/commit/f6c2ced))

## <small>1.1.15 (2026-06-06)</small>

* chore: update twd-js to 1.8.1
* chore: update puppeteer to 25.1.0
* chore: update vitest to 4.1.8

## <small>1.1.14 (2026-05-27)</small>

* feat: configurable protocolTimeout to avoid 180s suite aborts (#8) ([c03b054](https://github.com/BRIKEV/twd-cli/commit/c03b054)), closes [#8](https://github.com/BRIKEV/twd-cli/issues/8)

## <small>1.1.13 (2026-05-20)</small>

* feat: add Tests: summary line, Failed tests block, and MOCK prefix on contract lines (#7)

## <small>1.1.12 (2026-05-08)</small>

* chore: update twd-js to 1.8.0
* chore: update puppeteer to 24.43.0
* chore: update openapi-mock-validator to 0.3.0

## <small>1.1.11 (2026-05-04)</small>

* chore: update dependencies

## <small>1.1.10 (2026-04-21)</small>

* fix: forward mock Content-Type to contract validator (avoids false-positive `MISSING_SCHEMA` for binary mocks)

## <small>1.1.9 (2026-04-15)</small>

* chore: update twd-js to 1.7.1
* chore: update puppeteer to 24.41.0

## <small>1.1.8 (2026-04-15)</small>

* chore: update twd-js to 1.7.0

## <small>1.1.6 (2026-04-14)</small>

* chore: update twd-js to 1.6.6

## <small>1.1.5 (2026-04-08)</small>

* fix: mock overlap in contract validation (#4)

## <small>1.1.4 (2026-04-08)</small>

* chore: update dependencies
* chore: update openapi-mock-validator to 0.1.4

## <small>1.1.3 (2026-04-08)</small>

* chore: update dependencies
* chore: update openapi-mock-validator to 0.1.3

## 1.1.0 (2026-04-02)

* feat: contract validation — validate collected mocks against OpenAPI 3.0/3.1 specs
* feat: markdown contract report for CI/PR integration (`contractReportPath` config)
* feat: composite GitHub Action (`BRIKEV/twd-cli/.github/actions/run`) for simplified CI setup
* feat: comprehensive schema validation (string formats, number constraints, enum, array constraints, additionalProperties, nullable)
* fix: key collected mocks by alias so all mocks appear in the report
* perf: remove unnecessary `twd.visit()` from mock-only tests
* perf: reuse Ajv instance across validations (14x faster)
* ci: add E2E workflow with contract validation and PR reporting
* ci: pin action SHAs for supply chain security
* chore: update twd-js to 1.6.4
* docs: rewrite README with CI action usage and contract validation guide

## <small>1.0.20 (2026-03-16)</small>

* chore: update twd-js to 1.6.2

## <small>1.0.19 (2026-03-15)</small>

* feat: add configurable test retry mechanism (retryCount defaults to 2)
* feat: display retry summary after test results

## <small>1.0.18 (2026-03-06)</small>

* chore: update dependencies

## <small>1.0.17 (2026-03-02)</small>

* fix: include page URL in test failure error messages ([e355542](https://github.com/BRIKEV/twd-cli/commit/e355542))

## <small>1.0.16 (2026-02-11)</small>

* chore: update dependencies ([6713cf9](https://github.com/BRIKEV/twd-cli/commit/6713cf9))

## <small>1.0.14 (2026-02-10)</small>

* chore: update dependencies ([c2cde99](https://github.com/BRIKEV/twd-cli/commit/c2cde99))

## <small>1.0.14 (2026-02-08)</small>

* chore: update dependencies ([ac01cb6](https://github.com/BRIKEV/twd-cli/commit/ac01cb6))

## <small>1.0.13 (2026-02-04)</small>

* feat: update dependencies ([a40575c](https://github.com/BRIKEV/twd-cli/commit/53ec150))

## <small>1.0.12 (2026-01-29)</small>

* feat: update dependencies ([a40575c](https://github.com/BRIKEV/twd-cli/commit/a40575c))

## <small>1.0.11 (2026-01-13)</small>

* chore: update dependencies ([aece7d5](https://github.com/BRIKEV/twd-cli/commit/aece7d5))

## <small>1.0.10 (2026-01-11)</small>

* chore: update dependencies ([fdb6cc2](https://github.com/BRIKEV/twd-cli/commit/fdb6cc2))

## <small>1.0.9 (2025-12-29)</small>

* chore: update version to v1.0.9 ([9390790](https://github.com/BRIKEV/twd-cli/commit/9390790))

## <small>1.0.8 (2025-12-20)</small>

* chore: update dependencies ([9879cbb](https://github.com/BRIKEV/twd-cli/commit/9879cbb))

## <small>1.0.7 (2025-12-14)</small>

* feat: update twd version ([c3c8f65](https://github.com/BRIKEV/twd-cli/commit/c3c8f65))

## <small>1.0.5 (2025-12-03)</small>

* chore: update dependencies ([4cf3e77](https://github.com/BRIKEV/twd-cli/commit/4cf3e77))

## <small>1.0.4 (2025-11-26)</small>

* fix: better log errors ([25319ca](https://github.com/BRIKEV/twd-cli/commit/25319ca))

## <small>1.0.3 (2025-11-24)</small>

* fix: error selector ([1e081a6](https://github.com/BRIKEV/twd-cli/commit/1e081a6))

## <small>1.0.2 (2025-11-24)</small>

* feat: add basic cli feature ([23bde8c](https://github.com/BRIKEV/twd-cli/commit/23bde8c))
* feat: add basic testing for library contributing ([a041280](https://github.com/BRIKEV/twd-cli/commit/a041280))
* feat: add basic unit testing ([b0dba77](https://github.com/BRIKEV/twd-cli/commit/b0dba77))
* feat: add dependencies and package json ([bb3500f](https://github.com/BRIKEV/twd-cli/commit/bb3500f))
* feat: add example app ([011cd68](https://github.com/BRIKEV/twd-cli/commit/011cd68))
* feat: add example app with twd tests ([eb1130d](https://github.com/BRIKEV/twd-cli/commit/eb1130d))
* feat: remove ci workflow ([9b902f7](https://github.com/BRIKEV/twd-cli/commit/9b902f7))
* feat: restore previous command ([17afe99](https://github.com/BRIKEV/twd-cli/commit/17afe99))
* fix: deploy script ([2e14fed](https://github.com/BRIKEV/twd-cli/commit/2e14fed))
* fix: remove config variable ([0f4af94](https://github.com/BRIKEV/twd-cli/commit/0f4af94))
* fix: script process handling ([d5fb894](https://github.com/BRIKEV/twd-cli/commit/d5fb894))

## <small>1.0.1 (2025-11-24)</small>

* chore: update version to v1.0.1 ([038a51c](https://github.com/BRIKEV/twd-cli/commit/038a51c))
* fix: deploy script ([2e14fed](https://github.com/BRIKEV/twd-cli/commit/2e14fed))
* fix: remove config variable ([0f4af94](https://github.com/BRIKEV/twd-cli/commit/0f4af94))
* feat: add basic cli feature ([23bde8c](https://github.com/BRIKEV/twd-cli/commit/23bde8c))
* feat: add dependencies and package json ([bb3500f](https://github.com/BRIKEV/twd-cli/commit/bb3500f))
* feat: remove ci workflow ([9b902f7](https://github.com/BRIKEV/twd-cli/commit/9b902f7))
* ci: basic github action integration ([780a0df](https://github.com/BRIKEV/twd-cli/commit/780a0df))
* ci: comment integration ([c56b89c](https://github.com/BRIKEV/twd-cli/commit/c56b89c))
* Initial commit ([bc3eb91](https://github.com/BRIKEV/twd-cli/commit/bc3eb91))



