# twd-cli Video Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `npx twd-cli run --record` so a scoped test run produces a shareable video file.

**Architecture:** All changes are inside `twd-cli`. Two new pure-ish modules (`src/recordFilename.js` for artifact naming, `src/recorder.js` for the Puppeteer and ffmpeg surface) plus wiring into the existing `runTests` lifecycle in `src/index.js`. Recording is opt-in and every recording-only side effect is guarded, so non-recording runs behave exactly as they do today.

**Tech Stack:** Node ESM, Puppeteer `^25.3.0` (`page.screencast`, `page.setViewport`, `page.addStyleTag`), ffmpeg (external binary), Vitest.

## Global Constraints

- Repo is `/Users/kevinccbsg/brikev/twd-cli`. Do not modify the `twd` repo.
- Work on branch `docs/cli-video-recording-spec` (already checked out) or a branch off it.
- Node ESM only. Every import needs the `.js` extension.
- No test may require a real ffmpeg binary. `spawnSync` and `page.screencast` are always mocked.
- Recording defaults to OFF. Every recording-only call (`setViewport`, `addStyleTag`, `screencast`, the ffmpeg probe) must be guarded by `config.record?.enabled`. Use optional chaining, because existing tests build config objects with no `record` key at all.
- Follow the existing test convention: one test file per source module in `tests/`, Vitest, `vi.mock` at module top level.
- Conventional Commits for every commit.
- Do not use em-dashes in any file you write.
- Config defaults, copied verbatim from the spec:
  ```json
  {
    "enabled": false,
    "dir": "./twd-artifacts",
    "filename": null,
    "format": "mp4",
    "viewport": { "width": 1280, "height": 720, "deviceScaleFactor": 2 },
    "fps": 30,
    "speed": 1,
    "hideSidebar": true,
    "ffmpegPath": "ffmpeg"
  }
  ```

## File Structure

| File | Responsibility |
|---|---|
| `src/recordFilename.js` (new) | Pure. Slugify a test path, resolve the output filename. |
| `src/recorder.js` (new) | All ffmpeg and Puppeteer recording calls: probe, framing CSS, start, stop. |
| `src/config.js` (modify) | `record` defaults plus a two-level merge for that key. |
| `src/parseArgs.js` (modify) | Parse `--record`, `--record-dir`, `--record-speed`. |
| `src/index.js` (modify) | Lifecycle wiring and teardown. |
| `bin/twd-cli.js` (modify) | Help text. |
| `README.md`, `twd.config.example.json`, `.gitignore` (modify) | Docs and defaults. |

## Corrected lifecycle

The spec lists `screencast()` before handler enumeration. That is wrong: the filename depends on how many tests will run, which is only known once `baseIds` is resolved. Correct order, keyed to `src/index.js`:

1. Probe ffmpeg (recording only), before `puppeteer.launch()`
2. `puppeteer.launch()`
3. `browser.newPage()`
4. `page.setViewport(record.viewport)` (recording only)
5. `page.goto(config.url)`
6. `page.waitForSelector('#twd-sidebar-root')`
7. `page.addStyleTag(FRAMING_CSS)` (recording only, and only if `hideSidebar`)
8. Enumerate handlers
9. Resolve `--test` filters into `baseIds`
10. Compute filename, create `record.dir`, `page.screencast()` (recording only)
11. Run chunks
12. `recorder.stop()`
13. Coverage and contract handling (unchanged)
14. `browser.close()`

Starting at step 10 means the clip begins at the first test rather than at page load, and the "no tests matched" early return at `src/index.js:83` can never leave a recorder running.

---

### Task 1: Record config defaults and nested merge

`loadConfig` currently does a flat `{ ...DEFAULT_CONFIG, ...userConfig }`. A nested `record` key would be replaced wholesale rather than merged, so `{"record": {"format": "webm"}}` would silently lose every other record default. `record.viewport` is nested one level deeper and needs the same treatment.

**Files:**
- Modify: `src/config.js`
- Test: `tests/config.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `DEFAULT_RECORD` (exported object with the nine keys from Global Constraints). `loadConfig()` return value gains a `record` object that is always fully populated.

- [ ] **Step 1: Write the failing tests**

Add to `tests/config.test.js`, inside the existing `describe('loadConfig', ...)`:

```js
  it('includes fully populated record defaults when no config file exists', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    expect(loadConfig().record).toEqual({
      enabled: false,
      dir: './twd-artifacts',
      filename: null,
      format: 'mp4',
      viewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
      fps: 30,
      speed: 1,
      hideSidebar: true,
      ffmpegPath: 'ffmpeg',
    });
  });

  it('merges a partial record block instead of replacing it', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ record: { enabled: true, format: 'webm' } })
    );

    const { record } = loadConfig();

    expect(record.enabled).toBe(true);
    expect(record.format).toBe('webm');
    // every other default must survive
    expect(record.dir).toBe('./twd-artifacts');
    expect(record.fps).toBe(30);
    expect(record.speed).toBe(1);
    expect(record.hideSidebar).toBe(true);
    expect(record.ffmpegPath).toBe('ffmpeg');
    expect(record.viewport).toEqual({ width: 1280, height: 720, deviceScaleFactor: 2 });
  });

  it('merges a partial record.viewport instead of replacing it', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ record: { viewport: { width: 1920 } } })
    );

    expect(loadConfig().record.viewport).toEqual({
      width: 1920,
      height: 720,
      deviceScaleFactor: 2,
    });
  });

  it('leaves record at defaults when the user config omits it', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ headless: false }));

    const config = loadConfig();

    expect(config.headless).toBe(false);
    expect(config.record.enabled).toBe(false);
    expect(config.record.format).toBe('mp4');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest --run tests/config.test.js`
Expected: the four new tests FAIL because `config.record` is `undefined`.

Four *existing* tests will also fail once Step 3 lands, because they assert the whole config object with `toEqual`. Step 4 fixes those. Do not fix them yet.

- [ ] **Step 3: Implement**

In `src/config.js`, add the exported default above `DEFAULT_CONFIG`, add `record` to `DEFAULT_CONFIG`, and replace the merge:

```js
export const DEFAULT_RECORD = {
  enabled: false,
  dir: './twd-artifacts',
  filename: null,
  format: 'mp4',
  viewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
  fps: 30,
  speed: 1,
  hideSidebar: true,
  ffmpegPath: 'ffmpeg',
};

const DEFAULT_CONFIG = {
  url: 'http://localhost:5173',
  timeout: 10000,
  coverage: true,
  coverageDir: './coverage',
  nycOutputDir: './.nyc_output',
  headless: true,
  puppeteerArgs: ['--no-sandbox', '--disable-setuid-sandbox'],
  retryCount: 2,
  protocolTimeout: 300000,
  maxFailures: 10,
  chunkSize: 10,
  record: DEFAULT_RECORD,
};
```

Then, inside the `try` block, replace `return { ...DEFAULT_CONFIG, ...userConfig };` with:

```js
      const userRecord = userConfig.record || {};
      return {
        ...DEFAULT_CONFIG,
        ...userConfig,
        record: {
          ...DEFAULT_RECORD,
          ...userRecord,
          viewport: { ...DEFAULT_RECORD.viewport, ...(userRecord.viewport || {}) },
        },
      };
```

Leave the two `return DEFAULT_CONFIG;` paths (no file, invalid JSON) alone. They already carry the full defaults.

- [ ] **Step 4: Update the four existing whole-object assertions**

These four tests in `tests/config.test.js` compare the entire config with `toEqual` and now need the `record` key. Add `record: DEFAULT_RECORD,` as the last property of the expected object in each:

1. `'should load default config when no config file exists'`
2. `'should merge user config with defaults when config file exists'`
3. `'should return defaults and warn when config file has invalid JSON'`

And in `'should override all default values when user provides full config'`, the assertion is `expect(config).toEqual(userConfig)`. Change it to:

```js
    expect(config).toEqual({ ...userConfig, record: DEFAULT_RECORD });
```

Add `DEFAULT_RECORD` to the import at the top of the file:

```js
import { loadConfig, DEFAULT_RECORD } from '../src/config.js';
```

- [ ] **Step 5: Run the full config suite**

Run: `npx vitest --run tests/config.test.js`
Expected: PASS, all tests.

- [ ] **Step 6: Commit**

```bash
git add src/config.js tests/config.test.js
git commit -m "feat(config): add record defaults with nested merge"
```

---

### Task 2: Parse the record CLI flags

`parseRunArgs` currently returns `{ testFilters }`. It gains a `record` object holding only the keys the user actually set, so config-file values survive for everything else.

**Files:**
- Modify: `src/parseArgs.js`
- Test: `tests/parseArgs.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseRunArgs(argv)` returns `{ testFilters: string[], record: object }`. `record` is `{}` when no record flags are present, and may contain `enabled: true`, `dir: string`, `speed: number`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/parseArgs.test.js` inside the existing `describe`:

```js
  it("returns an empty record object when no record flags are present", () => {
    expect(parseRunArgs(['--test', 'Login']).record).toEqual({});
  });

  it("parses --record", () => {
    expect(parseRunArgs(['--record']).record).toEqual({ enabled: true });
  });

  it("parses --record-dir <value> and the = form", () => {
    expect(parseRunArgs(['--record-dir', './clips']).record).toEqual({ dir: './clips' });
    expect(parseRunArgs(['--record-dir=./clips']).record).toEqual({ dir: './clips' });
  });

  it("parses --record-speed as a number, both forms", () => {
    expect(parseRunArgs(['--record-speed', '0.5']).record).toEqual({ speed: 0.5 });
    expect(parseRunArgs(['--record-speed=2']).record).toEqual({ speed: 2 });
  });

  it("ignores a non-numeric or non-positive --record-speed", () => {
    expect(parseRunArgs(['--record-speed', 'slow']).record).toEqual({});
    expect(parseRunArgs(['--record-speed', '0']).record).toEqual({});
    expect(parseRunArgs(['--record-speed', '-1']).record).toEqual({});
  });

  it("ignores trailing record flags with no value", () => {
    expect(parseRunArgs(['--record-dir']).record).toEqual({});
    expect(parseRunArgs(['--record-speed']).record).toEqual({});
  });

  it("combines record flags with --test filters", () => {
    expect(parseRunArgs(['--record', '--test', 'checkout', '--record-speed=0.5'])).toEqual({
      testFilters: ['checkout'],
      record: { enabled: true, speed: 0.5 },
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest --run tests/parseArgs.test.js`
Expected: the new tests FAIL because `record` is `undefined`.

- [ ] **Step 3: Implement**

Replace the whole body of `src/parseArgs.js`:

```js
export function parseRunArgs(argv) {
  const testFilters = [];
  const record = {};

  const readValue = (token, prefix, index) => {
    if (token === prefix) {
      return { value: argv[index + 1], consumed: argv[index + 1] !== undefined ? 2 : 1 };
    }
    return { value: token.slice(prefix.length + 1), consumed: 1 };
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (token === '--test' || token.startsWith('--test=')) {
      const { value, consumed } = readValue(token, '--test', i);
      if (value !== undefined) testFilters.push(value);
      i += consumed - 1;
    } else if (token === '--record') {
      record.enabled = true;
    } else if (token === '--record-dir' || token.startsWith('--record-dir=')) {
      const { value, consumed } = readValue(token, '--record-dir', i);
      if (value !== undefined) record.dir = value;
      i += consumed - 1;
    } else if (token === '--record-speed' || token.startsWith('--record-speed=')) {
      const { value, consumed } = readValue(token, '--record-speed', i);
      const parsed = Number(value);
      if (value !== undefined && Number.isFinite(parsed) && parsed > 0) {
        record.speed = parsed;
      }
      i += consumed - 1;
    }
  }

  return { testFilters, record };
}
```

- [ ] **Step 4: Update the six existing whole-object assertions**

Every existing test in `tests/parseArgs.test.js` uses `toEqual({ testFilters: [...] })` and now needs `record: {}`. There are six. For example:

```js
  it("returns empty filters when no args", () => {
    expect(parseRunArgs([])).toEqual({ testFilters: [], record: {} });
  });
```

Apply the same edit to `"parses a single --test <value>"`, `"parses repeated --test flags in order"`, `"parses the --test=<value> form"`, `"ignores a trailing --test with no value"`, and `"ignores unknown tokens"`.

- [ ] **Step 5: Run the full parseArgs suite**

Run: `npx vitest --run tests/parseArgs.test.js`
Expected: PASS, all tests.

- [ ] **Step 6: Commit**

```bash
git add src/parseArgs.js tests/parseArgs.test.js
git commit -m "feat(cli): parse --record, --record-dir and --record-speed"
```

---

### Task 3: Resolve the artifact filename

Pure module, no I/O. Names the file after what is actually in it rather than after the filter that selected it.

**Files:**
- Create: `src/recordFilename.js`
- Test: `tests/recordFilename.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `slugify(text: string): string`
  - `resolveRecordFilename({ testNames: string[], filename: string|null, format: string }): string`

- [ ] **Step 1: Write the failing test**

Create `tests/recordFilename.test.js`:

```js
import { describe, it, expect } from "vitest";
import { slugify, resolveRecordFilename } from "../src/recordFilename.js";

describe("slugify", () => {
  it("lowercases and collapses non-alphanumerics to single hyphens", () => {
    expect(slugify('Login > shows error on bad password'))
      .toBe('login-shows-error-on-bad-password');
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify('  >>> Checkout <<<  ')).toBe('checkout');
  });

  it("truncates long paths without leaving a trailing hyphen", () => {
    const slug = slugify('a'.repeat(200));
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-')).toBe(false);
  });

  it("returns an empty string when nothing usable remains", () => {
    expect(slugify('>>> <<<')).toBe('');
  });
});

describe("resolveRecordFilename", () => {
  it("slugifies the single recorded test path", () => {
    expect(resolveRecordFilename({
      testNames: ['Login > shows error on bad password'],
      filename: null,
      format: 'mp4',
    })).toBe('login-shows-error-on-bad-password.mp4');
  });

  it("uses run.<ext> when more than one test is recorded", () => {
    expect(resolveRecordFilename({
      testNames: ['Login > a', 'Login > b'],
      filename: null,
      format: 'webm',
    })).toBe('run.webm');
  });

  it("uses run.<ext> when no tests are recorded", () => {
    expect(resolveRecordFilename({ testNames: [], filename: null, format: 'mp4' }))
      .toBe('run.mp4');
  });

  it("falls back to run.<ext> when the single test slugifies to nothing", () => {
    expect(resolveRecordFilename({ testNames: ['>>>'], filename: null, format: 'mp4' }))
      .toBe('run.mp4');
  });

  it("honours an explicit filename and appends the format extension", () => {
    expect(resolveRecordFilename({ testNames: [], filename: 'demo', format: 'mp4' }))
      .toBe('demo.mp4');
  });

  it("leaves an explicit filename alone when it already has a known extension", () => {
    expect(resolveRecordFilename({ testNames: [], filename: 'demo.webm', format: 'mp4' }))
      .toBe('demo.webm');
  });

  it("does not mistake a dot in the name for an extension", () => {
    expect(resolveRecordFilename({ testNames: [], filename: 'v1.2-demo', format: 'mp4' }))
      .toBe('v1.2-demo.mp4');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest --run tests/recordFilename.test.js`
Expected: FAIL, cannot resolve `../src/recordFilename.js`.

- [ ] **Step 3: Implement**

Create `src/recordFilename.js`:

```js
const MAX_SLUG_LENGTH = 80;
const KNOWN_EXTENSIONS = /\.(mp4|webm|gif)$/i;

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^-+|-+$/g, '');
}

export function resolveRecordFilename({ testNames, filename, format }) {
  const extension = `.${format}`;

  if (filename) {
    return KNOWN_EXTENSIONS.test(filename) ? filename : `${filename}${extension}`;
  }

  if (testNames.length === 1) {
    const slug = slugify(testNames[0]);
    if (slug) return `${slug}${extension}`;
  }

  return `run${extension}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest --run tests/recordFilename.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/recordFilename.js tests/recordFilename.test.js
git commit -m "feat(record): resolve artifact filename from recorded tests"
```

---

### Task 4: Recorder module

Wraps every ffmpeg and Puppeteer recording call so `src/index.js` stays readable and so the pieces are unit-testable without a browser.

**Files:**
- Create: `src/recorder.js`
- Test: `tests/recorder.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `FRAMING_CSS: string`
  - `assertFfmpegAvailable(ffmpegPath: string): void` (throws on missing binary)
  - `applyRecordingFraming(page, record): Promise<void>`
  - `startRecording(page, record, outputPath: string): Promise<ScreenRecorder>`

- [ ] **Step 1: Write the failing test**

Create `tests/recorder.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
vi.mock('fs');

import { spawnSync } from 'node:child_process';
import fs from 'fs';
import {
  FRAMING_CSS,
  assertFfmpegAvailable,
  applyRecordingFraming,
  startRecording,
} from "../src/recorder.js";

const baseRecord = {
  dir: './twd-artifacts',
  format: 'mp4',
  fps: 30,
  speed: 1,
  hideSidebar: true,
  ffmpegPath: 'ffmpeg',
};

describe("FRAMING_CSS", () => {
  it("hides the sidebar and resets the html margins with !important", () => {
    expect(FRAMING_CSS).toContain('#twd-sidebar-root');
    expect(FRAMING_CSS).toContain('display: none !important');
    expect(FRAMING_CSS).toContain('margin-left: 0 !important');
    expect(FRAMING_CSS).toContain('margin-right: 0 !important');
  });
});

describe("assertFfmpegAvailable", () => {
  beforeEach(() => vi.clearAllMocks());

  it("probes with -version and returns when the binary runs", () => {
    vi.mocked(spawnSync).mockReturnValue({ error: undefined });

    expect(() => assertFfmpegAvailable('ffmpeg')).not.toThrow();
    expect(spawnSync).toHaveBeenCalledWith('ffmpeg', ['-version']);
  });

  it("throws with install instructions when the binary is missing", () => {
    vi.mocked(spawnSync).mockReturnValue({ error: new Error('spawnSync ffmpeg ENOENT') });

    expect(() => assertFfmpegAvailable('ffmpeg')).toThrow(/ffmpeg/);
    expect(() => assertFfmpegAvailable('ffmpeg')).toThrow(/brew install ffmpeg/);
  });
});

describe("applyRecordingFraming", () => {
  beforeEach(() => vi.clearAllMocks());

  it("injects the framing stylesheet when hideSidebar is true", async () => {
    const page = { addStyleTag: vi.fn() };

    await applyRecordingFraming(page, { ...baseRecord, hideSidebar: true });

    expect(page.addStyleTag).toHaveBeenCalledWith({ content: FRAMING_CSS });
  });

  it("injects nothing when hideSidebar is false", async () => {
    const page = { addStyleTag: vi.fn() };

    await applyRecordingFraming(page, { ...baseRecord, hideSidebar: false });

    expect(page.addStyleTag).not.toHaveBeenCalled();
  });
});

describe("startRecording", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates the output directory and starts the screencast", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const recorder = { stop: vi.fn() };
    const page = { screencast: vi.fn().mockResolvedValue(recorder) };

    const result = await startRecording(page, baseRecord, '/abs/twd-artifacts/run.mp4');

    expect(fs.mkdirSync).toHaveBeenCalledWith('/abs/twd-artifacts', { recursive: true });
    expect(page.screencast).toHaveBeenCalledWith({
      path: '/abs/twd-artifacts/run.mp4',
      format: 'mp4',
      fps: 30,
      overwrite: true,
    });
    expect(result).toBe(recorder);
  });

  it("does not create the directory when it already exists", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const page = { screencast: vi.fn().mockResolvedValue({ stop: vi.fn() }) };

    await startRecording(page, baseRecord, '/abs/twd-artifacts/run.mp4');

    expect(fs.mkdirSync).not.toHaveBeenCalled();
  });

  it("passes speed only when it is not 1, to avoid a no-op ffmpeg filter", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const page = { screencast: vi.fn().mockResolvedValue({ stop: vi.fn() }) };

    await startRecording(page, { ...baseRecord, speed: 0.5 }, '/abs/out.mp4');

    expect(page.screencast).toHaveBeenCalledWith(
      expect.objectContaining({ speed: 0.5 })
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest --run tests/recorder.test.js`
Expected: FAIL, cannot resolve `../src/recorder.js`.

- [ ] **Step 3: Implement**

Create `src/recorder.js`:

```js
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'node:child_process';

/**
 * Hides the TWD sidebar for the duration of a recording.
 *
 * The html margin reset is not optional. twd-js's useLayout hook writes
 * `document.documentElement.style.marginLeft = '280px'` as an inline style while
 * the sidebar is open, so hiding the sidebar root on its own leaves a blank
 * gutter in frame. `!important` is what beats the inline style, and it survives
 * re-renders that would otherwise reapply the margin.
 */
export const FRAMING_CSS = [
  '#twd-sidebar-root { display: none !important; }',
  'html { margin-left: 0 !important; margin-right: 0 !important; }',
].join('\n');

const FFMPEG_INSTALL_HELP = [
  'Recording requires ffmpeg, which was not found.',
  '',
  '  macOS:   brew install ffmpeg',
  '  Linux:   sudo apt-get install ffmpeg',
  '  Windows: winget install ffmpeg',
  '',
  'Or set record.ffmpegPath in twd.config.json to an explicit binary path.',
].join('\n');

/**
 * Probes for ffmpeg before the browser launches.
 *
 * Puppeteer probes internally too, but only once the recorder is constructed,
 * which is after launch and navigation. Failing here saves a wasted run and
 * gives an actionable message.
 */
export function assertFfmpegAvailable(ffmpegPath) {
  const { error } = spawnSync(ffmpegPath, ['-version']);
  if (error) {
    throw new Error(FFMPEG_INSTALL_HELP);
  }
}

export async function applyRecordingFraming(page, record) {
  if (!record.hideSidebar) return;
  await page.addStyleTag({ content: FRAMING_CSS });
}

export async function startRecording(page, record, outputPath) {
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const options = {
    path: outputPath,
    format: record.format,
    fps: record.fps,
    overwrite: true,
  };

  // Puppeteer adds a `setpts` filter for any truthy speed, so a speed of 1
  // would add a no-op filter rather than none at all.
  if (record.speed && record.speed !== 1) {
    options.speed = record.speed;
  }

  return page.screencast(options);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest --run tests/recorder.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/recorder.js tests/recorder.test.js
git commit -m "feat(record): add ffmpeg probe, framing and screencast wrapper"
```

---

### Task 5: Wire recording into the run lifecycle

The teardown is the risky part. If `browser.close()` runs before `recorder.stop()`, the ffmpeg process is orphaned and the file is truncated or unplayable. `stop()` must run exactly once on the success path, the throwing-chunk path, and the interrupted path.

**Files:**
- Modify: `src/index.js`, `bin/twd-cli.js`
- Test: `tests/runTests.test.js`

**Interfaces:**
- Consumes: `DEFAULT_RECORD` is not needed here. Uses `resolveRecordFilename` from Task 3 and `assertFfmpegAvailable`, `applyRecordingFraming`, `startRecording` from Task 4. Uses the existing `buildTestPath(id, handlers)` from `src/buildTestPath.js`.
- Produces: `runTests({ testFilters, recordOverrides })`. `recordOverrides` is the `record` object from `parseRunArgs`, merged over `config.record`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/runTests.test.js`. First extend the mock page factory so it can record. Replace `createMockPage` with:

```js
function createMockPage({ handlers = [], testStatus = [], recorder } = {}) {
  return {
    goto: vi.fn(),
    waitForSelector: vi.fn(),
    evaluate: vi.fn()
      .mockResolvedValueOnce(handlers) // enumeration pass returns handler metadata
      .mockResolvedValue(testStatus),  // each chunk run returns its testStatus array
    exposeFunction: vi.fn(),
    setViewport: vi.fn(),
    addStyleTag: vi.fn(),
    screencast: vi.fn().mockResolvedValue(recorder ?? { stop: vi.fn() }),
  };
}
```

Then add a new describe block at the end of the file:

```js
describe("runTests recording", () => {
  const recordConfig = {
    enabled: true,
    dir: './twd-artifacts',
    filename: null,
    format: 'mp4',
    viewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
    fps: 30,
    speed: 1,
    hideSidebar: true,
    ffmpegPath: 'ffmpeg',
  };

  let consoleSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not touch any recording API when recording is disabled", async () => {
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig });
    const page = createMockPage({
      handlers: [{ id: '1', name: 'test1', type: 'test' }],
      testStatus: [{ id: '1', status: 'pass' }],
    });
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));

    await runTests();

    expect(page.setViewport).not.toHaveBeenCalled();
    expect(page.addStyleTag).not.toHaveBeenCalled();
    expect(page.screencast).not.toHaveBeenCalled();
  });

  it("sets the viewport, injects framing and starts the screencast when enabled", async () => {
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, record: recordConfig });
    const page = createMockPage({
      handlers: [
        { id: 's', name: 'Login', type: 'suite', children: ['1'] },
        { id: '1', name: 'shows error', type: 'test', parent: 's' },
      ],
      testStatus: [{ id: '1', status: 'pass' }],
    });
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));

    await runTests();

    expect(page.setViewport).toHaveBeenCalledWith(recordConfig.viewport);
    expect(page.addStyleTag).toHaveBeenCalled();
    expect(page.screencast).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining('login-shows-error.mp4'),
        format: 'mp4',
        overwrite: true,
      })
    );
  });

  it("stops the recorder before closing the browser", async () => {
    const order = [];
    const recorder = { stop: vi.fn(() => { order.push('stop'); }) };
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, record: recordConfig });
    const page = createMockPage({
      handlers: [{ id: '1', name: 'test1', type: 'test' }],
      testStatus: [{ id: '1', status: 'pass' }],
      recorder,
    });
    const browser = createMockBrowser(page);
    browser.close = vi.fn(() => { order.push('close'); });
    puppeteer.launch.mockResolvedValue(browser);

    await runTests();

    expect(order).toEqual(['stop', 'close']);
  });

  it("still stops the recorder when a chunk throws", async () => {
    const recorder = { stop: vi.fn() };
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, record: recordConfig });
    const page = createMockPage({
      handlers: [{ id: '1', name: 'test1', type: 'test' }],
      recorder,
    });
    page.evaluate = vi.fn()
      .mockResolvedValueOnce([{ id: '1', name: 'test1', type: 'test' }])
      .mockRejectedValue(new Error('boom'));
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(runTests()).rejects.toThrow('boom');

    expect(recorder.stop).toHaveBeenCalledTimes(1);
  });

  it("never starts a recorder when no test matches the filter", async () => {
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, record: recordConfig });
    const page = createMockPage({
      handlers: [{ id: '1', name: 'test1', type: 'test' }],
    });
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await runTests({ testFilters: ['nothing matches this'] });

    expect(page.screencast).not.toHaveBeenCalled();
  });

  it("applies CLI record overrides over the config file", async () => {
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, record: { ...recordConfig, enabled: false } });
    const page = createMockPage({
      handlers: [{ id: '1', name: 'test1', type: 'test' }],
      testStatus: [{ id: '1', status: 'pass' }],
    });
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));

    await runTests({ recordOverrides: { enabled: true, dir: './clips' } });

    expect(page.screencast).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('clips') })
    );
  });
});
```

Also add the recorder module to the mocks at the top of the file, so the ffmpeg probe never runs for real:

```js
vi.mock('../src/recorder.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, assertFfmpegAvailable: vi.fn() };
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest --run tests/runTests.test.js`
Expected: the new recording tests FAIL. The existing tests must still PASS, because `defaultMockConfig` has no `record` key and every recording call is guarded by optional chaining.

- [ ] **Step 3: Implement**

In `src/index.js`, add the imports:

```js
import { resolveRecordFilename } from './recordFilename.js';
import { assertFfmpegAvailable, applyRecordingFraming, startRecording } from './recorder.js';
```

Change the signature and add recording state at the top of `runTests`:

```js
export async function runTests(options = {}) {
  const { testFilters = [], recordOverrides = {} } = options;
  let browser;
  let config;
  let startedAt = null;
  let partialStatus = [];
  let partialHandlers = [];
  let recorder = null;
  let recordOutput = null;

  // Stops the screencast at most once. Must always run before browser.close():
  // if the browser goes first, ffmpeg is orphaned and the file is truncated.
  const stopRecorder = async () => {
    if (!recorder) return;
    const active = recorder;
    recorder = null;
    try {
      await active.stop();
    } catch (err) {
      console.warn(`Warning: could not finalize recording: ${err.message}`);
    }
  };

  try {
    config = loadConfig();
    const workingDir = process.cwd();
    const record = { ...(config.record || {}), ...recordOverrides };
    const recording = Boolean(record.enabled);

    if (recording) {
      assertFfmpegAvailable(record.ffmpegPath);
    }
```

After `const page = await browser.newPage();` add:

```js
    if (recording) {
      await page.setViewport(record.viewport);
    }
```

After the existing `await page.waitForSelector('#twd-sidebar-root', ...)` add:

```js
    if (recording) {
      await applyRecordingFraming(page, record);
    }
```

After the existing `const chunks = chunk(baseIds, config.chunkSize);` line, and before the `for (const ids of chunks)` loop, add:

```js
    if (recording) {
      const testNames = baseIds
        .map((id) => buildTestPath(id, registeredHandlers))
        .filter(Boolean);
      const filename = resolveRecordFilename({
        testNames,
        filename: record.filename,
        format: record.format,
      });
      recordOutput = path.join(record.dir, filename);
      recorder = await startRecording(page, record, path.resolve(workingDir, recordOutput));
    }
```

Immediately after the `for (const ids of chunks) { ... }` loop closes, add:

```js
    await stopRecorder();
    if (recording) {
      console.log(`Recorded ${executed} test(s) to ${recordOutput}`);
    }
```

Finally, in the `catch` block, replace `if (browser) await browser.close();` with:

```js
    await stopRecorder();
    if (browser) await browser.close();
```

- [ ] **Step 4: Run the full suite**

Run: `npx vitest --run`
Expected: PASS, every test file.

- [ ] **Step 5: Pass the flags through the bin entry**

In `bin/twd-cli.js`, change the run branch to forward the parsed record overrides:

```js
    const { testFilters, record } = parseRunArgs(process.argv.slice(3));
    const hasFailures = await runTests({ testFilters, recordOverrides: record });
```

- [ ] **Step 6: Commit**

```bash
git add src/index.js bin/twd-cli.js tests/runTests.test.js
git commit -m "feat(record): wire screencast into the run lifecycle"
```

---

### Task 6: Documentation and defaults

**Files:**
- Modify: `README.md`, `twd.config.example.json`, `.gitignore`, `bin/twd-cli.js`

**Interfaces:**
- Consumes: the flag set and config keys from Tasks 1, 2 and 5.
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Add the artifact directory to `.gitignore`**

Append to `.gitignore`, next to the existing `coverage` and `.nyc_output` entries:

```
# twd-cli recording artifacts
twd-artifacts
```

- [ ] **Step 2: Add the record block to `twd.config.example.json`**

```json
{
  "url": "http://localhost:5173",
  "timeout": 10000,
  "coverage": true,
  "coverageDir": "./coverage",
  "nycOutputDir": "./.nyc_output",
  "headless": true,
  "puppeteerArgs": ["--no-sandbox", "--disable-setuid-sandbox"],
  "protocolTimeout": 300000,
  "record": {
    "enabled": false,
    "dir": "./twd-artifacts",
    "filename": null,
    "format": "mp4",
    "viewport": { "width": 1280, "height": 720, "deviceScaleFactor": 2 },
    "fps": 30,
    "speed": 1,
    "hideSidebar": true,
    "ffmpegPath": "ffmpeg"
  }
}
```

- [ ] **Step 3: Update the help text in `bin/twd-cli.js`**

Add to the usage block, after the `--test` lines:

```
  npx twd-cli run --record          Record the run to a video file
```

And add to the Options section:

```
Options:
  --test "<name>"        Filter tests by "suite > test" path (repeatable, OR'd)
  --record               Record the run to a video file (requires ffmpeg)
  --record-dir <path>    Output directory (default ./twd-artifacts)
  --record-speed <n>     Playback speed, e.g. 0.5 for half speed

  --record-dir and --record-speed only set values. Recording still has to be
  turned on with --record or "record": { "enabled": true } in twd.config.json.

  Create a twd.config.json file in your project root to customize settings.
```

- [ ] **Step 4: Add a Recording section to `README.md`**

Insert after the existing `### Filtering tests` section and before `### Configuration`:

````markdown
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
`run.mp4`. Re-running overwrites the file.

The TWD sidebar is hidden during recording so the frame is just your app.

**A recorded run is a demo artifact, not a substitute for a CI run.** Recording
sets its own viewport (1280x720 by default, versus the 800x600 a normal run
uses) and reflows the app to full width, so a recorded run can pass or fail
differently. Run CI normally and record separately.
````

- [ ] **Step 5: Add the record options to `### Configuration Options`**

The existing section is a single markdown table. Add one row to it, matching the existing column order:

```markdown
| `record` | object | see below | Video recording settings (see [Recording a run](#recording-a-run)) |
```

Then add this subsection immediately after the existing "**Partial Results on Timeout or Crash:**" paragraph:

````markdown
#### Recording Options

All keys live under `record` in `twd.config.json`.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Turn recording on. Equivalent to passing `--record` |
| `dir` | string | `"./twd-artifacts"` | Directory the video is written to |
| `filename` | string \| null | `null` | Explicit output filename. When `null`, the name is derived from the recorded tests. A known extension (`.mp4`, `.webm`, `.gif`) is respected, otherwise `format` supplies it |
| `format` | string | `"mp4"` | `"mp4"`, `"webm"` or `"gif"`. All three are encoded natively, no conversion step |
| `viewport` | object | `{ "width": 1280, "height": 720, "deviceScaleFactor": 2 }` | Applied only when recording. Video dimensions are viewport times `deviceScaleFactor`, so the scale factor is what makes the clip crisp rather than soft |
| `fps` | number | `30` | Capture frame rate |
| `speed` | number | `1` | Playback speed, e.g. `0.5` for half speed. This is a **uniform stretch of the whole timeline**, not per-command pacing: it slows the fast parts and the already-slow parts equally and cannot hold on a just-clicked element |
| `hideSidebar` | boolean | `true` | Hide the TWD sidebar during capture so the frame is just your app |
| `ffmpegPath` | string | `"ffmpeg"` | Path to the ffmpeg binary if it is not on your `PATH` |
````

- [ ] **Step 6: Add ffmpeg to `## Requirements`**

The existing section is a two-bullet list. Add a third bullet:

```markdown
- **ffmpeg**, only for `--record`. Install with `brew install ffmpeg` (macOS),
  `sudo apt-get install ffmpeg` (Linux), or `winget install ffmpeg` (Windows).
  Set `record.ffmpegPath` if it is not on your `PATH`.
```

- [ ] **Step 7: Verify nothing regressed**

Run: `npx vitest --run`
Expected: PASS, every test file.

- [ ] **Step 8: Commit**

```bash
git add README.md twd.config.example.json .gitignore bin/twd-cli.js
git commit -m "docs(record): document video recording, flags and ffmpeg requirement"
```

---

## Manual verification

The automated tests mock ffmpeg and Puppeteer end to end, so one real run is worth doing before merge. From an example app with a dev server running:

```bash
npx twd-cli run --record --test "<a real test name>"
open twd-artifacts/*.mp4
```

Check: the file plays, the sidebar is absent, there is no blank gutter on the left or right, and the app fills the frame.

## Not in this plan

Per-command pacing and in-page overlays live in twd-js and are specced separately at `twd/specs/2026-07-27-twd-js-pacing-and-overlays-design.md`. Screenshots on failure need a `page.exposeFunction` event bridge and awaited runner events, and get their own spec.
