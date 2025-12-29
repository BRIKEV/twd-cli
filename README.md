# twd-cli

CLI tool for running [TWD (Test while developing)](https://brikev.github.io/twd/) tests using Puppeteer in CI/CD environments.

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

### Configuration

Create a `twd.config.json` file in your project root to customize settings:

```json
{
  "url": "http://localhost:5173",
  "timeout": 10000,
  "coverage": true,
  "coverageDir": "./coverage",
  "nycOutputDir": "./.nyc_output",
  "headless": true,
  "puppeteerArgs": ["--no-sandbox", "--disable-setuid-sandbox"]
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

## How It Works

1. Launches a Puppeteer browser instance
2. Navigates to your specified URL
3. Waits for your app to be ready
4. Executes all TWD tests via `window.__testRunner`
5. Collects and reports test results
6. Optionally collects code coverage data
7. Exits with appropriate code (0 for success, 1 for failures)

## CI/CD Integration

The CLI exits with code 1 if any tests fail, making it perfect for CI/CD pipelines.  
Puppeteer 24+ no longer auto-downloads Chrome, so make sure you install the browser on each runner (or restore it from a cache) before launching the tests.

```yaml
# Example GitHub Actions workflow
- name: Install dependencies
  run: npm ci

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
```

## Requirements

- Node.js >= 20.19.x
- A running development server with TWD tests
