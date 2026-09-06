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

Requires **ffmpeg** on your `PATH`, or `record.ffmpegPath` set. See [Requirements](#requirements).

Runs are **paced at 300ms by default**, so `--record` on its own produces something watchable rather than a one second blur. Pacing slows the run itself rather than stretching the video, so unlike `--record-speed` it costs no frame rate. It needs `twd-js` 1.9.0 or newer; on an older version the run still records, unpaced, with a warning.

```bash
npx twd-cli run --record --record-pace 500 --test "checkout flow"   # slower
npx twd-cli run --record --record-pace 0 --test "checkout flow"     # no pacing
```

One video per run, containing every matched test back to back in declaration order. Note that `--test` matches a substring of the full `"suite > test"` path, so one filter can match several tests. The file is named after its contents: a single recorded test gets a slug of its full path (`login-shows-error-on-bad-password.mp4`), anything else gets `run.<ext>`. Re-running overwrites it.

**A recorded run is a demo artifact, not a substitute for a CI run.** It sets its own viewport (1280x720, versus the 800x600 a normal run uses), reflows the app to full width, and pacing inserts real delays that can mask race conditions. Run CI unrecorded and record separately.

### Recording Options

Flags: `--record`, `--record-dir <path>`, `--record-speed <n>`, `--record-pace <ms>`. Everything else lives under `record` in `twd.config.json`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Turn recording on. Same as `--record` |
| `dir` | string | `"./twd-artifacts"` | Where the video is written |
| `filename` | string \| null | `null` | Explicit name. When `null`, derived from the recorded tests |
| `format` | string | `"mp4"` | `"mp4"`, `"webm"` or `"gif"`, all encoded natively |
| `viewport` | object | `1280x720` | Applied only when recording. `width` and `height` set the video dimensions |
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
- ffmpeg, only for `--record`. Install with `brew install ffmpeg` (macOS),
  `sudo apt-get install ffmpeg` (Linux), or `winget install ffmpeg` (Windows).
  Set `record.ffmpegPath` if it is not on your `PATH`.
