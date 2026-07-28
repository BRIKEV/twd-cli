# twd-cli

CI/CD runner for [TWD (Test while developing)](https://brikev.github.io/twd/) — executes your in-browser TWD tests in a headless environment. Puppeteer is only used to open the page; all tests run inside the real browser context against real DOM.

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

### Recording a run

Record a test run to a video file, for a PR attachment, a docs clip, or a demo:

```bash
# Record one flow
npx twd-cli run --record --test "checkout flow"

# Record at half speed, into a custom directory
npx twd-cli run --record --record-speed 0.5 --record-dir ./clips
```

Requires ffmpeg. See [Requirements](#requirements).

The run produces a single video containing every matched test, back to back, in
declaration order. Note that `--test` matches a substring of the full
`"suite > test"` path, so one filter can match several tests.

The file is named after what is in it: a single recorded test gets a slug of its
full path (`login-shows-error-on-bad-password.mp4`), and anything else gets
`run.<ext>`, where `<ext>` comes from `format` (`mp4` by default, or `webm`/`gif`
if you set that). Re-running overwrites the file.

The TWD sidebar is hidden during recording so the frame is just your app.

Chrome only emits video frames when the page repaints, so a suite that only
asserts and never changes anything on screen can finish with an empty file. When
that happens the run says so rather than reporting a video you cannot play.

**A recorded run is a demo artifact, not a substitute for a CI run.** Recording
sets its own viewport (1280x720 by default, versus the 800x600 a normal run
uses) and reflows the app to full width, so a recorded run can pass or fail
differently. Run CI normally and record separately.

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
| `record` | object | see below | Video recording settings (see [Recording a run](#recording-a-run)) |

**Partial Results on Timeout or Crash:** Tests run in chunks (controlled by `chunkSize`), so on a `protocolTimeout` or unexpected crash mid-run, results from completed chunks are printed instead of being lost entirely.

#### Recording Options

All keys live under `record` in `twd.config.json`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Turn recording on. Equivalent to passing `--record` |
| `dir` | string | `"./twd-artifacts"` | Directory the video is written to |
| `filename` | string \| null | `null` | Explicit output filename. When `null`, the name is derived from the recorded tests. A known extension (`.mp4`, `.webm`, `.gif`) is respected, otherwise `format` supplies it |
| `format` | string | `"mp4"` | `"mp4"`, `"webm"` or `"gif"`. All three are encoded natively, no conversion step |
| `viewport` | object | `{ "width": 1280, "height": 720, "deviceScaleFactor": 1 }` | Applied only when recording. `width` and `height` set the video dimensions. `deviceScaleFactor` does **not** change the output resolution (Puppeteer measures the recording in CSS pixels), it only changes the page environment under test: raising it makes `srcset` and `image-set` pick 2x assets and sends dpr-branching code down a different path |
| `fps` | number | `30` | Capture frame rate |
| `speed` | number | `1` | Playback speed, e.g. `0.5` for half speed. This is a **uniform stretch of the whole timeline**, not per-command pacing: it slows the fast parts and the already-slow parts equally and cannot hold on a just-clicked element |
| `pace` | number | `300` | Milliseconds twd-js holds after each command, so the run itself is slower. **On by default**, because an unpaced recording is about a second long and unwatchable. Unlike `speed` this costs no frame rate, since the execution is paced rather than the video stretched. See [Pace versus speed](#pace-versus-speed). Set `0` to disable |
| `preRoll` | number | `0` | Milliseconds to hold the opening state before the first test runs. Purely cosmetic |
| `postRoll` | number | `500` | Milliseconds to hold the final state after the last test. **Not cosmetic:** without it the last thing your test did never appears in the video at all. See [Why the ending needs a hold](#why-the-ending-needs-a-hold). Set `0` only if you do not care about the ending |
| `hideSidebar` | boolean | `true` | Hide the TWD sidebar during capture so the frame is just your app |
| `ffmpegPath` | string | `"ffmpeg"` | Path to the ffmpeg binary if it is not on your `PATH` |

#### Why the ending needs a hold

Chrome only sends a video frame when the page repaints, and Puppeteer holds each
frame until the *next* one arrives, because the next frame's timestamp is what
says how long to display the current one. The newest frame is therefore never
written, and stopping the recorder pads the tail by repeating the one before it.

A settled page produces no more repaints, so simply waiting does not help.
Measured against real Chrome: stopping immediately ended two states early, and a
400ms plain wait still ended one state early.

`postRoll` fixes this by briefly repainting the whole viewport with an invisible
overlay after the last test, which forces the real final frame through and then
holds it. This is why it defaults to on.

#### Pace versus speed

`postRoll` fixes the *ending*, not the *pace*. Tests run in milliseconds, so a
two-test run is around a second of video. `speed` and `pace` both make that
longer, in opposite ways.

`speed` is an ffmpeg filter applied after recording. It stretches the same
frames over a longer timeline, so the effective frame rate falls in proportion:
measured on identical activity, 30fps at `speed: 1`, 15.3fps at `0.5` and 7.7fps
at `0.25`. It also slows the dead air exactly as much as the interesting moments.

`pace` slows the run itself. twd-js holds briefly after each command, so frames
are captured at full rate and the pauses land where something just happened.
Typing is spaced out per keystroke too, so text appears character by character.

Pacing is on by default at 300ms, so `--record` alone gives you something
watchable. Reach for `speed` only when you cannot afford a slower run.

```bash
# Paced at 300ms, no extra flags
npx twd-cli run --record --test "checkout flow"

# Slower, for a more deliberate demo
npx twd-cli run --record --record-pace 500 --test "checkout flow"

# Off, for the fastest possible recorded run
npx twd-cli run --record --record-pace 0 --test "checkout flow"
```

Values between 200 and 500 tend to read well.

**The cost is wall clock.** Roughly, a 50 test suite averaging 10 actions per
test gains about 2.5 minutes at 300ms and 4 minutes at 500ms. That is the reason
to scope a recorded run with `--test` rather than record everything.

Hitting `protocolTimeout` is unlikely: a chunk is `chunkSize` tests inside a
single browser call bounded by that timeout, so at 300ms you would need around
100 actions in a single test to reach it. If you do somehow get there, lower
`chunkSize` or raise `protocolTimeout`.

Pacing also inserts real delays between actions, which can hide race conditions,
so a paced run is even less representative of CI than a recorded run already is.

Pacing needs `twd-js` 1.9.0 or newer. On an older version the run still
completes and still records, but unpaced, with a warning saying so.

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

## Requirements

- Node.js >= 20.19.x
- A running development server with TWD tests
- ffmpeg, only for `--record`. Install with `brew install ffmpeg` (macOS),
  `sudo apt-get install ffmpeg` (Linux), or `winget install ffmpeg` (Windows).
  Set `record.ffmpegPath` if it is not on your `PATH`.
