# twd-cli

CI/CD runner for [TWD (Test while developing)](https://brikev.github.io/twd/) — executes your in-browser TWD tests in a headless environment. Puppeteer is only used to open the page; all tests run inside the real browser context against real DOM.

- [Installation](#installation)
- [Usage](#usage): running tests, filtering, configuration
- [Recording](#recording): capture a run to video, paced so it is watchable
- [Contract Validation](#contract-validation): check your mocks against OpenAPI specs
- [CI/CD Integration](#cicd-integration): GitHub Action and custom setups
- [Sharding across CI jobs](#sharding-across-ci-jobs) **(beta)**: split a long run across parallel jobs ([details](docs/sharding.md))
- [How It Works](#how-it-works)
- [Requirements](#requirements)

## Installation

```bash
npm install twd-cli
```

Or use directly with npx:

```bash
npx twd-cli run
```

## Usage

### Basic Usage

Run tests with default configuration:

```bash
npx twd-cli run
```

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

### Running only what this branch changed

`--changed-since <ref>` works out which tests the current branch added or
changed and runs only those. It replaces the "diff, grep for `it()` titles,
build a `--test` loop" script that every consumer was writing:

```bash
npx twd-cli run --changed-since origin/main

# Most useful with --record: a reviewer watches what the PR built,
# not the whole suite.
npx twd-cli run --record --changed-since origin/main
```

How the set is worked out:

1. `git merge-base <ref> HEAD` for the base, falling back to `<ref>` itself —
   a branch is not always a descendant of wherever the base has moved to.
2. `it()` titles on lines the branch **added**, in `*.twd.test.*` files only.
   The tests that already lived in the same file are noise, and pacing makes
   them expensive to record.
3. If the diff added no `it()` at all, every title in the changed files —
   a body can change without its title line moving, and recording nothing
   would be worse than recording a little too much.

`it()` and `it.only()` are selected; `it.skip()`, `it.todo()` and `xit()` never
are, since a test that does not run cannot be recorded. Uncommitted and
untracked test files count too, so the test you just wrote is picked up without
committing first.

Notes:

- **A branch that changed no tests prints one line and exits `0`.** An empty
  result is a normal CI outcome, not a failure — unlike `--test`, which is an
  assertion you typed and still exits `1` when it matches nothing. This is
  decided before the browser launches, so such a run needs no dev server at all.
- **It unions with `--test`** rather than overriding it, so you can add one
  extra test to a branch's own.
- **The base branch has to be in the clone.** `actions/checkout` defaults to
  `fetch-depth: 1`, which fetches no history; set `fetch-depth: 0`. The error
  says so if you forget.
- It is a filter, not a recording feature — `--record` is optional.

### Configuration

Create a `twd.config.json` file in your project root:

```json
{
  "url": "http://localhost:5173",
  "timeout": 10000,
  "coverage": true,
  "coverageDir": "./coverage",
  "nycOutputDir": "./.nyc_output",
  "headless": true,
  "puppeteerArgs": ["--no-sandbox", "--disable-setuid-sandbox"],
  "retryCount": 2,
  "protocolTimeout": 300000,
  "maxFailures": 10,
  "chunkSize": 10
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | string | `"http://localhost:5173"` | The URL of your development server |
| `timeout` | number | `10000` | Timeout in milliseconds for page load |
| `coverage` | boolean | `true` | Enable/disable code coverage collection |
| `coverageDir` | string | `"./coverage"` | Directory to store coverage reports |
| `nycOutputDir` | string | `"./.nyc_output"` | Directory for NYC output |
| `headless` | boolean | `true` | Run browser in headless mode |
| `puppeteerArgs` | string[] | `["--no-sandbox", "--disable-setuid-sandbox"]` | Additional Puppeteer launch arguments |
| `retryCount` | number | `2` | Number of attempts per test before reporting failure. Set to `1` to disable retries |
| `protocolTimeout` | number | `300000` | Puppeteer CDP `protocolTimeout` in ms (5 min). Tests run in chunks via `runByIds`, so this bounds a **single chunk's browser call** (not the entire run) — raise it (e.g. `600000`) for slow CI or if individual chunks hang; `0` means no timeout. Defaults above Puppeteer's implicit 180000ms ceiling |
| `maxFailures` | number | `10` | Stop the run once this many tests have failed in total; the CLI prints the results gathered so far and exits non-zero. Set `0` to disable and always run every test |
| `chunkSize` | number | `10` | How many tests run per browser call. Smaller values make the failure limit and timeouts more granular (less work lost if one chunk hangs); larger values reduce overhead. `0` runs everything in one call |
| `contracts` | array | — | OpenAPI contract validation specs (see [Contract Validation](#contract-validation)) |
| `contractReportPath` | string | — | Path to write a markdown report for CI/PR integration |
| `viewport` | object | `{ "width": 1280, "height": 800 }` | Browser viewport for every run. Layout snapshots are only reproducible when this is fixed and explicit. While recording, `record.viewport` wins |
| `snapshotDir` | string | `"__twd_snapshots__"` | Where layout snapshot references and failure captures live. Must match the `dir` given to the `twdSnapshot` Vite plugin |
| `record` | object | see below | Video recording settings (see [Recording](#recording)) |

**Partial Results on Timeout or Crash:** Tests run in chunks (controlled by `chunkSize`), so on a `protocolTimeout` or unexpected crash mid-run, results from completed chunks are printed instead of being lost entirely.

## Recording

Record a run to a video file, for a PR attachment, a docs clip, or a demo:

```bash
npx twd-cli run --record --test "checkout flow"
```

Requires **ffmpeg 8 or newer** on your `PATH`, or `record.ffmpegPath` set. Older builds are checked and rejected before the browser launches, with the reason. See [Requirements](#requirements).

Runs are **paced at 300ms by default**, so `--record` on its own produces something watchable rather than a one second blur. Pacing slows the run itself rather than stretching the video, so unlike `--record-speed` it costs no frame rate. It needs `twd-js` 1.9.0 or newer; on an older version the run still records, unpaced, with a warning.

```bash
npx twd-cli run --record --record-pace 500 --test "checkout flow"   # slower
npx twd-cli run --record --record-pace 0 --test "checkout flow"     # no pacing
```

When several tests match, each one is recorded to its own clip, named after its
`suite > test` path. A reviewer watches the criterion they doubt instead of
scrubbing a single file for it.

One clip for the whole run is still what you get from a single matched test, from
`record.filename` (one name cannot address several clips), and from more matched
tests than `record.maxClips` (default 20, set 0 to disable). The run says which
of those applied.

Each clip is named after its `suite > test` path slug. When a single clip covers the whole run (from a single test, explicit filename, or exceeding maxClips), it is named `run.<ext>`. Note that `--test` matches a substring of the full `"suite > test"` path, so one filter can match several tests. Re-running overwrites existing clips.

mp4 recordings are converted to H.264 / `yuv420p` once the run ends, so they open in QuickTime, Preview and every browser — and land at roughly a quarter of the size. If your ffmpeg has no `libx264` the original is kept and you get a warning; that file is VP9 and plays only in Chrome or VLC.

The recording viewport is **1280x1600** by default — deliberately taller than a screen. Puppeteer captures exactly the viewport, with no scrolling and no letterboxing, so anything below the fold is simply absent from the video and nothing in the run says so. A short default silently cropped the very content the tests asserted on. Set `record.viewport` if your app is shorter and you would rather not record empty space.

**A recorded run is a demo artifact, not a substitute for a CI run.** It sets its own viewport (1280x1600, versus the 1280x800 a normal run uses), reflows the app to full width, and pacing inserts real delays that can mask race conditions. Run CI unrecorded and record separately.

### Recording Options

Flags: `--record`, `--record-dir <path>`, `--record-speed <n>`, `--record-pace <ms>`. Everything else lives under `record` in `twd.config.json`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Turn recording on. Same as `--record` |
| `dir` | string | `"./twd-artifacts"` | Where the video is written |
| `filename` | string \| null | `null` | Explicit name. When `null`, derived from the recorded tests |
| `format` | string | `"mp4"` | `"mp4"` (converted to H.264 after the run), `"webm"` or `"gif"` |
| `viewport` | object | `1280x1600` | Applied only when recording. `width` and `height` set the video dimensions. Tall on purpose: what is below the fold is not in the video. Keep both even — the H.264 conversion needs it |
| `fps` | number | `30` | Capture frame rate |
| `speed` | number | `1` | Post-hoc playback speed. Costs frame rate, prefer `pace` |
| `pace` | number | `300` | Milliseconds held after each command. `0` disables |
| `preRoll` | number | `0` | Milliseconds held on the opening state |
| `postRoll` | number | `500` | Milliseconds held on the final state. Without it the last thing your test did never appears in the video |
| `hideSidebar` | boolean | `true` | Hide the TWD sidebar so the frame is just your app |
| `ffmpegPath` | string | `"ffmpeg"` | Path to the binary if it is not on your `PATH` |

Full explanations, including why `postRoll` is on by default and the measured frame rate cost of `speed`, are in the [Recording Runs](https://brikev.github.io/twd/recording) docs.

## Layout snapshots (beta)

`twd-js` 1.10.0 adds `twd.matchLayout`, which watches the **geometry** of a page
and fails when it moves. It is off in the browser sidebar on purpose, because
the sidebar resizes the page and a developer's window is an arbitrary size, so
**twd-cli is where a layout snapshot is actually decided.**

```bash
# Compare against the committed references
npx twd-cli run

# Accept the current layout as the new reference
npx twd-cli run --update-snapshots

# A missing reference is a failure, never created
npx twd-cli run --ci
```

### The two flags are separate on purpose

| Flag | What it does |
|------|--------------|
| `--update-snapshots` | Rewrites references that already exist. Without it, a changed layout fails, which is the point |
| `--ci` | Forbids *creating* a reference. Without it, a brand new test writes its own baseline on the first CI run and passes forever, and nobody finds out |

They close two different holes, which is why they are two flags rather than one
mode. `--ci` outranks `--update-snapshots`: both set, with no reference on disk,
is a failure and not a write.

### Seeing what changed

A failure writes `<name>.failed.png` next to the reference: your page as it
rendered, with the rows that diverged boxed in red. In CI the machine that
produced it is gone by the time anyone looks, so twd-cli also writes a
self-contained **`.twd/snapshot-report.html`** with every capture embedded.

One file, one artifact, opens in any browser:

```yaml
- name: Upload layout snapshot failures
  if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: layout-snapshots
    path: .twd/snapshot-report.html
```

Captures from earlier runs are cleared before each run, so the report only ever
shows failures from the run you are looking at. The committed `.snap` references
next to them are never touched.

### Two things to know

**The viewport changed.** twd-cli now sets an explicit viewport on every run
(`1280x800` by default), not just when recording. Before, a normal run inherited
Puppeteer's implicit size. A test that happened to depend on the old size can
start behaving differently. Set `viewport` in `twd.config.json` to pin your own.

**`snapshotDir` has to match the Vite plugin.** twd-cli and the `twdSnapshot`
plugin are separate processes that never talk, so the directory is configured
twice. If the report comes out empty when you expected failures, this is the
first thing to check.

## How It Works

**Important**: Puppeteer is **not** used as a testing framework here. It simply provides a headless browser to load your application — the same way a user would open Chrome. Once the page loads, all test execution happens inside the real browser context through the [TWD runner](https://brikev.github.io/twd/). Your tests interact with real DOM, real components, and real browser APIs — Puppeteer just opens the door and gets out of the way.

**Contract Validation**: Mock overlaps are automatically handled — if multiple tests or calls use the same alias but with different HTTP methods/URLs/statuses, all are validated separately (no silent drops).

1. Launches a headless browser via Puppeteer (the only thing Puppeteer does)
2. Navigates to your dev server URL
3. Waits for the app and TWD sidebar to be ready
4. TWD's in-browser test runner executes all tests against the real DOM
5. Collects and reports test results
6. Validates collected mocks against OpenAPI contracts (if configured)
7. Optionally collects code coverage data
8. Exits with appropriate code (0 for success, 1 for failures)

## CI/CD Integration

### Using the GitHub Action (recommended)

The easiest way to run TWD tests in CI. Handles Puppeteer caching, Chrome installation, and optional contract report posting in a single step:

```yaml
name: TWD Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  pull-requests: write  # only needed if using contract-report

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Install mock service worker
        run: npx twd-js init public --save

      - name: Start dev server
        run: |
          nohup npm run dev > /dev/null 2>&1 &
          npx wait-on http://localhost:5173

      - name: Run TWD tests
        uses: BRIKEV/twd-cli/.github/actions/run@main
        with:
          contract-report: 'true'
```

#### Action Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `working-directory` | `.` | Directory where `twd.config.json` lives |
| `contract-report` | `false` | Post contract validation summary as a PR comment |
| `shard` | (empty) | Run one shard of the suite, as `<index>/<total>` (e.g. `2/4`). Leave empty to run everything in one job. See [Sharding](#sharding-across-ci-jobs) |
| `report-dir` | `.twd/run` | Where the shard report is written. Only used when `shard` is set |
| `upload-report` | `true` | Upload the shard report as an artifact named `twd-run-<index>`, the layout `twd-cli merge` expects. Only used when `shard` is set |

#### With code coverage

The action runs in the same job, so coverage data is available for subsequent steps:

```yaml
      - name: Run TWD tests
        uses: BRIKEV/twd-cli/.github/actions/run@main

      - name: Display coverage
        run: npm run collect:coverage:text
```

### Recording a PR's tests (the `record` action)

The sibling of the `run` action, for clips rather than results. It installs a
known-good ffmpeg, records, and uploads the result:

```yaml
- uses: BRIKEV/twd-cli/.github/actions/record@main
  with:
    changed-since: ${{ github.event.pull_request.base.sha }}
```

`changed-since` is what keeps the clip watchable — it records only the tests the
branch touched, rather than the whole suite. See
[Running only what this branch changed](#running-only-what-this-branch-changed).

#### Record action inputs

| Input | Default | Description |
|-------|---------|-------------|
| `working-directory` | `.` | Directory where `twd.config.json` lives |
| `changed-since` | (empty) | A ref. Records only the tests changed since it. Needs `fetch-depth: 0` on checkout. Mutually exclusive with `tests` |
| `tests` | (empty) | Newline-separated test titles, one `--test` each. Mutually exclusive with `changed-since` |
| `pace` | (empty) | Passed to `--record-pace`. Empty uses the CLI default of 300; `0` disables pacing |
| `install-ffmpeg` | `true` | Install ffmpeg 8.x. Set `false` to use whatever is on `PATH` |
| `upload-artifact` | `true` | Upload the clips as an artifact |
| `artifact-name` | `twd-recording` | Name of the artifact |
| `retention-days` | `14` | How long to keep it |

#### Record action outputs

| Output | Description |
|--------|-------------|
| `clip-count` | Number of clips written. One per test when several tests match, one for the whole run when they do not (a single test, an explicit record.filename, or more tests than record.maxClips). **`0` is a valid, non-failing result** — a branch that changed no tests has nothing to record |
| `dir` | Where the clips are, for a caller that wants to do its own upload |
| `artifact-url` | URL of the artifact, when the action uploaded it |

#### Why it installs ffmpeg

Because the distro build is not good enough, and finding that out the hard way is
expensive. Puppeteer's screencast passes `-movflags hybrid_fragmented`, which
arrived after ffmpeg 7 — `apt-get install ffmpeg` on `ubuntu-24.04` gets you
6.1.1, which rejects it. The action installs an 8.1.x build whose `gpl` variant
also carries `libx264`, which the H.264 conversion needs. Set
`install-ffmpeg: false` if you manage your own; `twd-cli` checks the binary can
actually do the job before it launches a browser either way.

Only Linux runners get the bundled build. On macOS or Windows the step warns and
skips, so install ffmpeg 8+ yourself there.

#### Reference workflow

Recording is triggered by a label here, but that part is policy — record every PR
to `main` if you prefer. The trigger, the PR comment and the dev server stay in
your workflow rather than the action, exactly as they do for `run`:

```yaml
name: Record a PR's tests
on:
  pull_request:
    types: [labeled]

jobs:
  record:
    if: github.event.label.name == 'record'
    runs-on: ubuntu-latest
    timeout-minutes: 15          # a hung recording must not cost the whole job
    permissions: { contents: read, pull-requests: write }
    steps:
      - uses: actions/checkout@v5
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          fetch-depth: 0         # --changed-since needs history
      - uses: actions/setup-node@v5
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: |
          nohup npm run dev > vite.log 2>&1 &
          npx wait-on http://localhost:5173
      - uses: BRIKEV/twd-cli/.github/actions/record@main
        id: rec
        continue-on-error: true  # a clip is optional; the PR it describes is not
        with:
          changed-since: ${{ github.event.pull_request.base.sha }}
      - if: steps.rec.outputs.clip-count != '0'
        run: gh pr comment "$PR" --body "${{ steps.rec.outputs.clip-count }} clip(s): ${{ steps.rec.outputs.artifact-url }}"
        env:
          GH_TOKEN: ${{ github.token }}
          PR: ${{ github.event.pull_request.number }}
```

The `timeout-minutes` and `continue-on-error` are belt, not workaround. A
recording is always optional; the pull request it describes is not.

### Custom setup (without the action)

If you prefer full control, set up each step manually. Puppeteer 24+ no longer auto-downloads Chrome, so you need to install it explicitly:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v5

      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Install mock service worker
        run: npx twd-js init public --save

      - name: Start dev server
        run: |
          nohup npm run dev > /dev/null 2>&1 &
          npx wait-on http://localhost:5173

      - name: Cache Puppeteer browsers
        uses: actions/cache@v4
        with:
          path: ~/.cache/puppeteer
          key: ${{ runner.os }}-puppeteer-${{ hashFiles('package-lock.json') }}
          restore-keys: |
            ${{ runner.os }}-puppeteer-

      - name: Install Chrome for Puppeteer
        run: npx puppeteer browsers install chrome

      - name: Run TWD tests
        run: npx twd-cli run

      - name: Display coverage
        run: npm run collect:coverage:text
```

## Contract Validation

Validate your test mocks against OpenAPI specs to catch drift between your mocks and the real API. When a mock response doesn't match the spec, you'll see errors like:

```
Source: ./contracts/users-3.0.json   ERROR

  ✓ GET /users (200) — mock "getUsers" — in "UserList > should display all users"
  ✗ GET /users/{userId} (200) — mock "getUserBadAddress" — in "UserDetails > should fetch user details"
    → response.address.city: missing required property
    → response.address.country: missing required property

  ⚠ GET /users/{userId} (404) — mock "getUserNotFound" 2nd time — in "UserDetails > should show not found"
    Status 404 not documented for GET /users/{userId}
```

### Setup

1. Add your OpenAPI specs to the project (JSON format, 3.0 or 3.1):

```
contracts/
  users-3.0.json
  posts-3.1.json
```

2. Configure contracts in `twd.config.json`:

```json
{
  "url": "http://localhost:5173",
  "contractReportPath": ".twd/contract-report.md",
  "contracts": [
    {
      "source": "./contracts/users-3.0.json",
      "baseUrl": "/api",
      "mode": "error",
      "strict": true
    },
    {
      "source": "./contracts/posts-3.1.json",
      "baseUrl": "/api",
      "mode": "warn",
      "strict": true
    }
  ]
}
```

### Contract Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `source` | string | — | Path to the OpenAPI spec file (JSON) |
| `baseUrl` | string | `"/"` | Base URL prefix to strip when matching mock URLs to spec paths |
| `mode` | `"error"` \| `"warn"` | `"warn"` | `error` fails the test run, `warn` reports but doesn't fail |
| `strict` | boolean | `true` | When true, rejects unexpected properties not defined in the spec |

### Supported Schema Validations

The validator checks all standard OpenAPI/JSON Schema constraints:

- **Types**: `string`, `number`, `integer`, `boolean`, `array`, `object`
- **String**: `minLength`, `maxLength`, `pattern`, `format` (date, date-time, email, uuid, uri, hostname, ipv4, ipv6)
- **Number/Integer**: `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`
- **Array**: `minItems`, `maxItems`, `uniqueItems`
- **Object**: `required`, `additionalProperties`
- **Composition**: `oneOf`, `anyOf`, `allOf`
- **Enum**: validates against allowed values
- **Nullable**: supports both OpenAPI 3.0 (`nullable: true`) and 3.1 (`type: ["string", "null"]`)

### PR Reports

When `contractReportPath` is set and you use the action with `contract-report: 'true'`, a summary table is posted as a PR comment:

| Spec | Passed | Failed | Warnings | Mode |
|------|--------|--------|----------|------|
| `users-3.0.json` | 2 | 3 | 1 | `error` |
| `posts-3.1.json` | 2 | 2 | 0 | `warn` |

Failed validations are included in a collapsible details section with a link to the full CI log.

## Sharding across CI jobs

> **Beta.** Strictly additive: a run without `--shard` behaves exactly as before,
> so turning this on cannot affect your existing pipeline. How tests are assigned
> to shards may still change — see [docs/sharding.md](docs/sharding.md).

Long suites can be split across parallel CI jobs. Each shard runs one slice of
the suite and writes a report; `twd-cli merge` joins them into a single summary
and owns the exit code.

```bash
npx twd-cli run --shard 2/4     # "I am job 2 of 4"
npx twd-cli merge .twd/shards   # join the reports back together
```

The `4` is how many jobs you are running, **not** how many tests exist — each
shard discovers the whole suite itself and keeps every 4th test, so the suite can
grow without a workflow edit.

**Sharding only pays on long suites.** It trades fixed per-job setup for parallel
execution, so a suite that runs in seconds comes out *slower*. As a rule of
thumb, two shards win once test time is more than twice the merge job's cost.

See **[docs/sharding.md](docs/sharding.md)** for the full workflow, the three
conditions that are easy to get wrong, the break-even maths with measured
numbers, and the caveats — test independence, `maxFailures` being per shard, and
coverage on a red run.

## Requirements

- Node.js >= 20.19.x
- A running development server with TWD tests
- ffmpeg **8 or newer**, only for `--record`. Install with `brew install ffmpeg`
  (macOS), `sudo apt-get install ffmpeg` (Linux), or `winget install ffmpeg`
  (Windows). Set `record.ffmpegPath` if it is not on your `PATH`.

  The version matters, and "not the distro build" is not enough. Puppeteer's
  screencast passes `-movflags hybrid_fragmented`, which arrived after ffmpeg 7:

  | ffmpeg | works |
  |---|---|
  | 6.1.1 (Ubuntu 24.04) | no |
  | 7.0.2 (johnvansickle static) | no |
  | 8.1.2 | yes |

  On Ubuntu CI runners, install a build of 8.x rather than the packaged one.
  `twd-cli` probes the capability, not the version number, so a future ffmpeg
  that drops the flag is caught too.
