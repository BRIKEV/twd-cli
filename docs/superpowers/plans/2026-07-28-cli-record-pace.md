# twd-cli Record Pace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `npx twd-cli run --record --record-pace 500` slow a recorded run down to a watchable speed.

**Architecture:** twd-js exposes a `window.__twdSetPace(ms)` tooling global that spaces out its own command loop. twd-cli gains one config key, one CLI flag, and one `page.evaluate` call that drives it. All of it is gated on recording being enabled, so a normal run is untouched.

**Tech Stack:** Node ESM, Puppeteer, Vitest.

Spec: `twd/specs/2026-07-28-twd-js-command-pacing-design.md`

## Prerequisite

The twd-js half must ship first. This plan calls `window.__twdSetPace`, which does not exist until then. If that global is missing at runtime the `page.evaluate` throws, so do not merge this ahead of the twd release.

## Global Constraints

- Repo is `/Users/kevinccbsg/brikev/twd-cli`. This plan does NOT touch the `twd` repo.
- Node ESM only. Every relative import needs the `.js` extension.
- **Pacing must only ever happen inside a recorded run.** Every new call site is gated on `record.enabled`.
- Recording still defaults to off, and existing tests build config objects with no `record` key, so keep using optional chaining and never assume the key exists.
- `record.pace` defaults to `0`, meaning no pacing. There is no non-zero default, because the right value depends on the app.
- No test may require a real browser.
- Follow the existing one-test-file-per-module convention in `tests/`, Vitest.
- Conventional Commits.
- **Commit messages must NOT contain any `Co-Authored-By` trailer or Claude Code attribution.** End the message at its last content line.
- Do not use em-dashes. `README.md` has pre-existing ones in untouched sections; leave those, just do not add new ones.

## File Structure

| File | Responsibility |
|---|---|
| `src/config.js` (modify) | `record.pace` default, inside the existing `DEFAULT_RECORD`. |
| `src/parseArgs.js` (modify) | `--record-pace <ms>` joins the three existing record flags. |
| `src/index.js` (modify) | One `page.evaluate` after `startRecording`. |
| `bin/twd-cli.js` (modify) | Help text row. |
| `README.md` (modify) | Recording options table row and a note on when to use it. |

---

### Task 1: The pace knob

Config default and CLI flag together, since neither is useful alone and both are a few lines.

**Files:**
- Modify: `src/config.js`, `src/parseArgs.js`
- Test: `tests/config.test.js`, `tests/parseArgs.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `loadConfig().record.pace` (number, default `0`), and `parseRunArgs(argv).record.pace` set only when the flag is passed.

- [ ] **Step 1: Write the failing tests**

Add to `tests/config.test.js` inside the existing `describe('loadConfig', ...)`:

```js
  it('defaults record.pace to 0 so recording never paces unless asked', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    expect(loadConfig().record.pace).toBe(0);
  });

  it('merges a partial record.pace without dropping the other record defaults', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ record: { pace: 500 } })
    );

    const { record } = loadConfig();

    expect(record.pace).toBe(500);
    expect(record.postRoll).toBe(500);
    expect(record.format).toBe('mp4');
    expect(record.viewport).toEqual({ width: 1280, height: 720, deviceScaleFactor: 1 });
  });
```

Add to `tests/parseArgs.test.js` inside the existing `describe`:

```js
  it("parses --record-pace as a number, both forms", () => {
    expect(parseRunArgs(['--record-pace', '500']).record).toEqual({ pace: 500 });
    expect(parseRunArgs(['--record-pace=250']).record).toEqual({ pace: 250 });
  });

  it("ignores a non-numeric or non-positive --record-pace", () => {
    expect(parseRunArgs(['--record-pace', 'slow']).record).toEqual({});
    expect(parseRunArgs(['--record-pace', '0']).record).toEqual({});
    expect(parseRunArgs(['--record-pace', '-1']).record).toEqual({});
  });

  it("ignores a trailing --record-pace with no value", () => {
    expect(parseRunArgs(['--record-pace']).record).toEqual({});
  });

  it("combines --record-pace with --record and a test filter", () => {
    expect(parseRunArgs(['--record', '--test', 'checkout', '--record-pace=500'])).toEqual({
      testFilters: ['checkout'],
      record: { enabled: true, pace: 500 },
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest --run tests/config.test.js tests/parseArgs.test.js`
Expected: the new tests FAIL. `record.pace` is `undefined` and the flag is not parsed.

One existing test will also fail once Step 3 lands: `'includes fully populated record defaults when no config file exists'` asserts the whole `record` object with `toEqual`. Step 5 fixes it.

- [ ] **Step 3: Add the config default**

In `src/config.js`, add to `DEFAULT_RECORD` immediately after `speed`:

```js
  // Milliseconds twd-js holds after each command, driven through
  // window.__twdSetPace. 0 disables pacing. No non-zero default: the right
  // value depends on the app.
  pace: 0,
```

- [ ] **Step 4: Add the CLI flag**

In `src/parseArgs.js`, add a branch alongside the existing `--record-speed` handling. It mirrors that branch exactly, including the positive-finite guard:

```js
    } else if (token === '--record-pace' || token.startsWith('--record-pace=')) {
      const { value, consumed } = readValue(token, '--record-pace', i);
      const parsed = Number(value);
      if (value !== undefined && Number.isFinite(parsed) && parsed > 0) {
        record.pace = parsed;
      }
      i += consumed - 1;
```

- [ ] **Step 5: Update the existing whole-object assertion**

In `tests/config.test.js`, the test `'includes fully populated record defaults when no config file exists'` compares the entire `record` object. Add `pace: 0,` to the expected object, immediately after `speed: 1,` so it matches the declaration order.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest --run tests/config.test.js tests/parseArgs.test.js`
Expected: PASS.

- [ ] **Step 7: Run the full suite**

Run: `npx vitest --run`
Expected: PASS, every file.

- [ ] **Step 8: Commit**

```bash
git add src/config.js src/parseArgs.js tests/config.test.js tests/parseArgs.test.js
git commit -m "feat(record): add the record.pace knob and --record-pace flag"
```

---

### Task 2: Drive the pace and document it

**Files:**
- Modify: `src/index.js`, `bin/twd-cli.js`, `README.md`
- Test: `tests/runTests.test.js`

**Interfaces:**
- Consumes: `record.pace` from Task 1. Calls `window.__twdSetPace(ms)`, provided by twd-js, which returns the pace actually applied after clamping.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Add a new describe block at the end of `tests/runTests.test.js`:

```js
describe("runTests pacing", () => {
  const paceConfig = {
    enabled: true,
    dir: './twd-artifacts',
    filename: null,
    format: 'mp4',
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    fps: 30,
    speed: 1,
    pace: 500,
    preRoll: 0,
    postRoll: 500,
    hideSidebar: true,
    ffmpegPath: 'ffmpeg',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // An earlier describe's restoreAllMocks puts these back to their real
    // implementations, so neuter them again.
    vi.mocked(assertFfmpegAvailable).mockReset();
    vi.mocked(holdOpeningFrame).mockReset();
    vi.mocked(holdFinalFrame).mockReset();
    vi.mocked(fs.statSync).mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function pacedPage(applied = 500) {
    const page = createMockPage({
      handlers: [{ id: '1', name: 'test1', type: 'test' }],
      testStatus: [{ id: '1', status: 'pass' }],
    });
    // Enumeration, then the setPace evaluate, then the chunk.
    page.evaluate = vi.fn()
      .mockResolvedValueOnce([{ id: '1', name: 'test1', type: 'test' }])
      .mockResolvedValueOnce(applied)
      .mockResolvedValue([{ id: '1', status: 'pass' }]);
    return page;
  }

  it("sets the pace in the page when recording with a pace", async () => {
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, record: paceConfig });
    const page = pacedPage();
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));

    await runTests();

    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 500);
  });

  it("does not set a pace when record.pace is 0", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig,
      record: { ...paceConfig, pace: 0 },
    });
    const page = createMockPage({
      handlers: [{ id: '1', name: 'test1', type: 'test' }],
      testStatus: [{ id: '1', status: 'pass' }],
    });
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));

    await runTests();

    expect(page.evaluate).not.toHaveBeenCalledWith(expect.any(Function), 0);
  });

  it("does not set a pace when recording is disabled", async () => {
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig });
    const page = createMockPage({
      handlers: [{ id: '1', name: 'test1', type: 'test' }],
      testStatus: [{ id: '1', status: 'pass' }],
    });
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));

    await runTests();

    expect(page.evaluate).not.toHaveBeenCalledWith(expect.any(Function), 500);
  });

  it("warns when twd-js clamps the requested pace", async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig,
      record: { ...paceConfig, pace: 99999 },
    });
    const page = pacedPage(5000);
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));

    await runTests();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('5000'));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest --run tests/runTests.test.js`
Expected: the new tests FAIL, no evaluate call carries the pace.

- [ ] **Step 3: Drive the pace**

In `src/index.js`, immediately after `recorder = await startRecording(page, record, recordOutputPath);` and before `await holdOpeningFrame(record.preRoll);`:

```js
      if (record.pace) {
        // twd-js spaces out its own command loop. It clamps, so report back
        // what actually took effect.
        const applied = await page.evaluate((ms) => window.__twdSetPace(ms), record.pace);
        if (applied !== record.pace) {
          console.warn(`Warning: pace clamped to ${applied}ms (requested ${record.pace}ms).`);
        }
      }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest --run tests/runTests.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest --run`
Expected: PASS, every file.

- [ ] **Step 6: Update the help text**

In `bin/twd-cli.js`, add to the Options section after the `--record-speed` line, aligning the description column with its siblings:

```
  --record-pace <ms>     Slow the run itself so the video is watchable
```

- [ ] **Step 7: Document the option**

In `README.md`, add a row to the Recording Options table immediately after the `speed` row:

```markdown
| `pace` | number | `0` | Milliseconds twd-js holds after each command, so the run itself is slower and the video is watchable at full frame rate. Unlike `speed`, this does not cost frame rate, because the execution is paced rather than the video stretched. `0` disables it |
```

Then add this subsection immediately after the existing "Making the video longer" subsection:

````markdown
#### Pace versus speed

`speed` and `pace` both make a video longer, in opposite ways.

`speed` is an ffmpeg filter applied after recording. It stretches the same frames
over a longer timeline, so the effective frame rate falls in proportion:
measured, identical activity gives 30fps at `speed: 1`, 15.3fps at `0.5` and
7.7fps at `0.25`. It also slows the dead air exactly as much as the interesting
moments.

`pace` slows the run itself. twd-js holds briefly after each command, so frames
are captured at full rate and the pauses land where something just happened.
Typing is also spaced out per keystroke, so text appears character by character.

Prefer `pace`. Reach for `speed` only when you cannot afford a slower run.

```bash
npx twd-cli run --record --record-pace 500 --test "checkout flow"
```

Two things to know. A paced run takes substantially longer, so pace with a
`--test` filter rather than across a whole suite: a chunk is `chunkSize` tests
inside a single browser call bounded by `protocolTimeout`, and enough pacing will
exceed it. And pacing inserts real delays between actions, which can hide race
conditions, so a paced run is even less representative of CI than a recorded run
already is.
````

- [ ] **Step 8: Verify nothing regressed**

Run: `npx vitest --run`
Expected: PASS, every file.

- [ ] **Step 9: Commit**

```bash
git add src/index.js bin/twd-cli.js README.md tests/runTests.test.js
git commit -m "feat(record): drive twd-js command pacing from --record-pace"
```

---

## Manual verification

Everything above is mocked, so one real run is worth doing against an example app with its dev server running, using a twd-js build that includes the pacing hook:

```bash
npx twd-cli run --record --record-pace 500 --test "<a real test name>"
open twd-artifacts/*.mp4
```

Check: the clip is noticeably longer than the same run without `--record-pace`, the pauses land after each action rather than at random, text appears character by character, and the frame rate has not dropped (`ffprobe -v error -show_entries stream=avg_frame_rate -of csv=p=0 twd-artifacts/*.mp4` should still report 30).

## Not in this plan

The twd-js half (`src/pace.ts`, the `window.__twdSetPace` hook, and the userEvent and visit wiring) is a separate plan in the `twd` repo and must ship first.
