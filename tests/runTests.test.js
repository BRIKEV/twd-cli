import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from 'node:events';
import { runTests } from "../src/index.js";
import { REPORT_SCHEMA_VERSION } from "../src/runReport.js";

vi.mock('fs');
vi.mock('puppeteer');
vi.mock('../src/config.js', () => ({
  loadConfig: vi.fn(),
}));
vi.mock('../src/contracts.js', () => ({
  loadContracts: vi.fn(),
  validateMocks: vi.fn(),
}));
vi.mock('../src/contractReport.js', () => ({
  printContractReport: vi.fn(),
}));
// The two ffmpeg-spawning helpers are mocked so no test needs a real binary.
// The two hold helpers are mocked so their call ordering is observable here;
// their real behavior is covered in tests/recorder.test.js. watchRecorder and
// stopRecording are deliberately NOT mocked: the hang they exist to prevent
// only shows up in the wiring, so these tests run the real ones.
vi.mock('../src/recorder.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    assertFfmpegCapable: vi.fn(),
    transcodeForPlayback: vi.fn(() => ({ ok: true })),
    holdOpeningFrame: vi.fn(),
    holdFinalFrame: vi.fn(),
  };
});

import fs from 'fs';
import puppeteer from 'puppeteer';
import { loadConfig } from '../src/config.js';
import { loadContracts, validateMocks } from '../src/contracts.js';
import { printContractReport } from '../src/contractReport.js';
import { assertFfmpegCapable, transcodeForPlayback, holdOpeningFrame, holdFinalFrame } from '../src/recorder.js';

// puppeteer's screencast returns a PassThrough fed by ffmpeg's stdout, and the
// stream ending early is the only signal that the encoder died. A plain object
// would make watchRecorder untestable here.
function createMockRecorder(stop) {
  const recorder = new EventEmitter();
  recorder.stop = stop ?? vi.fn().mockResolvedValue(undefined);
  return recorder;
}

function createMockPage({ handlers = [], testStatus = [], recorder } = {}) {
  return {
    goto: vi.fn(),
    waitForSelector: vi.fn(),
    evaluate: vi.fn()
      .mockResolvedValueOnce(handlers) // enumeration pass returns handler metadata
      .mockResolvedValue(testStatus),  // each chunk run returns its testStatus array
    exposeFunction: vi.fn(),
    evaluateOnNewDocument: vi.fn(),
    setViewport: vi.fn(),
    addStyleTag: vi.fn(),
    screencast: vi.fn().mockResolvedValue(recorder ?? createMockRecorder()),
  };
}

// Runs a function destined for evaluateOnNewDocument against a stand-in window,
// and hands back what it wrote.
function runInjected(inject, flags) {
  const had = 'window' in globalThis;
  const previous = globalThis.window;
  const win = {};
  globalThis.window = win;
  try {
    inject(flags);
  } finally {
    if (had) globalThis.window = previous;
    else delete globalThis.window;
  }
  return win;
}

function createMockBrowser(page) {
  return {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn(),
  };
}

const defaultMockConfig = {
  url: 'http://localhost:5173',
  timeout: 10000,
  coverage: false,
  coverageDir: './coverage',
  nycOutputDir: './.nyc_output',
  headless: true,
  puppeteerArgs: [],
  retryCount: 2,
  maxFailures: 10,
  chunkSize: 50,
  viewport: { width: 1280, height: 800 },
  snapshotDir: '__twd_snapshots__',
};

describe("runTests", () => {
  let consoleSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should pass retryCount to page.evaluate", async () => {
    const testStatus = [{ id: '1', status: 'pass' }];
    const handlers = [{ id: '1', name: 'test1', type: 'test' }];
    const page = createMockPage({ handlers, testStatus });
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig,
      retryCount: 3,
    });

    await runTests();

    // page.evaluate is called with (fn, retryCount, selectedIds)
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 3, ['1']);
  });

  it("should pass protocolTimeout to puppeteer.launch", async () => {
    const testStatus = [{ id: '1', status: 'pass' }];
    const handlers = [{ id: '1', name: 'test1', type: 'test' }];
    const page = createMockPage({ handlers, testStatus });
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig,
      protocolTimeout: 600000,
    });

    await runTests();

    expect(puppeteer.launch).toHaveBeenCalledWith(
      expect.objectContaining({ protocolTimeout: 600000 })
    );
  });

  it("should print a protocolTimeout hint when the run aborts on timeout", async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const page = createMockPage({});
    const timeoutError = new Error('Runtime.callFunctionOn timed out.');
    timeoutError.name = 'ProtocolError';
    page.evaluate = vi.fn().mockRejectedValue(timeoutError);
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await expect(runTests()).rejects.toThrow('timed out');

    const errors = errorSpy.mock.calls.map((c) => String(c[0]));
    expect(errors.some((e) => e.includes('protocolTimeout'))).toBe(true);
    expect(browser.close).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("should include retried tests in the run-complete block", async () => {
    const testStatus = [
      { id: '1', status: 'pass', retryAttempt: 2 },
      { id: '2', status: 'pass' },
    ];
    const handlers = [
      { id: '1', name: 'flaky test', type: 'test' },
      { id: '2', name: 'stable test', type: 'test' },
    ];
    const page = createMockPage({ handlers, testStatus });
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runTests();

    const logs = consoleSpy.mock.calls.map(c => String(c[0]));
    const block = logs.find(l => l.startsWith('--- Run complete ---'));
    expect(block).toBeDefined();
    expect(block).toContain('Retried (1):');
    expect(block).toContain('✓ flaky test (passed on attempt 2)');
  });

  it("should not include a retried section when no tests were retried", async () => {
    const testStatus = [{ id: '1', status: 'pass' }];
    const handlers = [{ id: '1', name: 'test1', type: 'test' }];
    const page = createMockPage({ handlers, testStatus });
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runTests();

    const logs = consoleSpy.mock.calls.map(c => String(c[0]));
    const block = logs.find(l => l.startsWith('--- Run complete ---'));
    expect(block).toBeDefined();
    expect(block).not.toContain('Retried');
  });

  it("should return true when tests have failures", async () => {
    const testStatus = [{ id: '1', status: 'fail', error: 'boom' }];
    const handlers = [{ id: '1', name: 'test1', type: 'test' }];
    const page = createMockPage({ handlers, testStatus });
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    const result = await runTests();

    expect(result).toBe(true);
  });

  it("should return false when all tests pass", async () => {
    const testStatus = [{ id: '1', status: 'pass' }];
    const handlers = [{ id: '1', name: 'test1', type: 'test' }];
    const page = createMockPage({ handlers, testStatus });
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    const result = await runTests();

    expect(result).toBe(false);
  });

  it("accumulates results across multiple chunks", async () => {
    const handlers = [
      { id: 's1', name: 'Suite', type: 'suite' },
      { id: 't1', name: 't1', parent: 's1', type: 'test' },
      { id: 't2', name: 't2', parent: 's1', type: 'test' },
      { id: 't3', name: 't3', parent: 's1', type: 'test' },
    ];
    const page = {
      goto: vi.fn(),
      evaluateOnNewDocument: vi.fn(),
      setViewport: vi.fn(),
      waitForSelector: vi.fn(),
      exposeFunction: vi.fn(),
      evaluate: vi.fn()
        .mockResolvedValueOnce(handlers)                                   // enumeration
        .mockResolvedValueOnce([{ id: 't1', status: 'pass' }])             // chunk 1
        .mockResolvedValueOnce([{ id: 't2', status: 'fail', error: 'boom' }]) // chunk 2
        .mockResolvedValueOnce([{ id: 't3', status: 'pass' }]),            // chunk 3
    };
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, chunkSize: 1 });

    const result = await runTests();

    expect(result).toBe(true); // one failure across chunks
    expect(page.evaluate).toHaveBeenCalledTimes(4); // enumeration + 3 chunks
    const block = consoleSpy.mock.calls.map((c) => String(c[0])).at(-1);
    expect(block).toContain('Passed: 2 | Failed: 1 | Skipped: 0');
  });

  it("should skip contract validation when no contracts configured", async () => {
    const testStatus = [{ id: '1', status: 'pass' }];
    const handlers = [{ id: '1', name: 'test1', type: 'test' }];
    const page = createMockPage({ handlers, testStatus });
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runTests();

    expect(loadContracts).not.toHaveBeenCalled();
  });

  it("should run contract validation when contracts configured", async () => {
    const testStatus = [{ id: '1', status: 'pass' }];
    const handlers = [{ id: '1', name: 'test1', type: 'test' }];
    const page = createMockPage({ handlers, testStatus });
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig,
      contracts: [{ source: './openapi.json' }],
    });
    vi.mocked(loadContracts).mockResolvedValue([]);
    vi.mocked(validateMocks).mockReturnValue({ results: [], skipped: [] });
    vi.mocked(printContractReport).mockReturnValue(false);

    await runTests();

    expect(loadContracts).toHaveBeenCalled();
    expect(page.exposeFunction).toHaveBeenCalledWith('__twdCollectMock', expect.any(Function));
  });

  it("should return true when contract errors in error mode", async () => {
    const testStatus = [{ id: '1', status: 'pass' }];
    const handlers = [{ id: '1', name: 'test1', type: 'test' }];
    const page = createMockPage({ handlers, testStatus });
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig,
      contracts: [{ source: './openapi.json', mode: 'error' }],
    });
    vi.mocked(loadContracts).mockResolvedValue([]);
    vi.mocked(validateMocks).mockReturnValue({ results: [], skipped: [] });
    vi.mocked(printContractReport).mockReturnValue(true);

    const result = await runTests();

    expect(result).toBe(true);
  });

  it("preserves responseHeaders through the __twdCollectMock spread", async () => {
    const testStatus = [{ id: 't-1', status: 'pass' }];
    const handlers = [{ id: 't-1', name: 'test1', type: 'test' }];

    const page = {
      goto: vi.fn(),
      evaluateOnNewDocument: vi.fn(),
      setViewport: vi.fn(),
      waitForSelector: vi.fn(),
      exposeFunction: vi.fn(),
      evaluate: vi.fn()
        .mockResolvedValueOnce(handlers) // enumeration pass
        // Drive the registered __twdCollectMock callback from inside page.evaluate,
        // mirroring how a real browser test would trigger it.
        .mockImplementation(async () => {
          const exposed = page.exposeFunction.mock.calls.find(
            (c) => c[0] === '__twdCollectMock'
          );
          expect(exposed).toBeDefined();
          const collectMock = exposed[1];
          await collectMock({
            alias: 'getPhoto',
            url: '/v1/photo',
            method: 'GET',
            status: 200,
            response: 'bin',
            testId: 't-1',
            responseHeaders: { 'Content-Type': 'image/png' },
          });
          return testStatus;
        }),
    };
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig,
      contracts: [{ source: './openapi.json' }],
    });
    vi.mocked(loadContracts).mockResolvedValue([{ /* sentinel contract */ }]);

    let capturedMocks;
    vi.mocked(validateMocks).mockImplementation((mocks) => {
      capturedMocks = mocks;
      return { results: [], skipped: [] };
    });
    vi.mocked(printContractReport).mockReturnValue(false);

    await runTests();

    expect(capturedMocks).toBeDefined();
    const entries = Array.from(capturedMocks.values());
    expect(entries).toHaveLength(1);
    expect(entries[0].responseHeaders).toEqual({ 'Content-Type': 'image/png' });
    expect(entries[0].alias).toBe('getPhoto');
    expect(entries[0].occurrence).toBe(1);
  });

  it("passes all test ids to the run evaluate when no filter", async () => {
    const testStatus = [{ id: '1', status: 'pass' }];
    const handlers = [{ id: '1', name: 'test1', type: 'test' }];
    const page = createMockPage({ handlers, testStatus });
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runTests();

    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 2, ['1']);
  });

  it("runs only matching tests when a --test filter is given", async () => {
    const registry = [
      { id: 's1', name: 'Login', parent: undefined, type: 'suite' },
      { id: 't1', name: 'shows error', parent: 's1', type: 'test' },
      { id: 't2', name: 'redirects', parent: 's1', type: 'test' },
    ];
    const page = {
      goto: vi.fn(),
      evaluateOnNewDocument: vi.fn(),
      setViewport: vi.fn(),
      waitForSelector: vi.fn(),
      exposeFunction: vi.fn(),
      evaluate: vi.fn()
        .mockResolvedValueOnce(registry)                    // enumeration pass
        .mockResolvedValueOnce([{ id: 't1', status: 'pass' }]), // chunk run pass
    };
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    const result = await runTests({ testFilters: ['shows error'] });

    expect(result).toBe(false);
    // second evaluate call is the run; selectedIds is the matched ids
    expect(page.evaluate).toHaveBeenNthCalledWith(2, expect.any(Function), 2, ['t1']);
  });

  it("returns true and skips the run when a filter matches nothing", async () => {
    const registry = [
      { id: 't1', name: 'shows error', parent: undefined, type: 'test' },
    ];
    const page = {
      goto: vi.fn(),
      evaluateOnNewDocument: vi.fn(),
      setViewport: vi.fn(),
      waitForSelector: vi.fn(),
      exposeFunction: vi.fn(),
      evaluate: vi.fn().mockResolvedValueOnce(registry),
    };
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await runTests({ testFilters: ['nope'] });

    expect(result).toBe(true);
    expect(page.evaluate).toHaveBeenCalledTimes(1); // enumeration only, no run
    expect(browser.close).toHaveBeenCalled();
    const errors = errorSpy.mock.calls.map((c) => String(c[0]));
    expect(errors.some((e) => e.includes('No tests matched') && e.includes('nope'))).toBe(true);
    errorSpy.mockRestore();
  });

  it("warns about filters that matched nothing on a partial match", async () => {
    const registry = [
      { id: 's1', name: 'Login', parent: undefined, type: 'suite' },
      { id: 't1', name: 'shows error', parent: 's1', type: 'test' },
    ];
    const page = {
      goto: vi.fn(),
      evaluateOnNewDocument: vi.fn(),
      setViewport: vi.fn(),
      waitForSelector: vi.fn(),
      exposeFunction: vi.fn(),
      evaluate: vi.fn()
        .mockResolvedValueOnce(registry)
        .mockResolvedValueOnce([{ id: 't1', status: 'pass' }]),
    };
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await runTests({ testFilters: ['Login', 'nope'] });

    expect(result).toBe(false);
    expect(page.evaluate).toHaveBeenNthCalledWith(2, expect.any(Function), 2, ['t1']);
    const warnings = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(warnings.some((w) => w.includes('matched no tests') && w.includes('nope'))).toBe(true);
    expect(warnings.some((w) => w.includes('"Login"'))).toBe(false);
    warnSpy.mockRestore();
  });

  it("skips coverage collection when a filter is active", async () => {
    const registry = [
      { id: 't1', name: 'shows error', parent: undefined, type: 'test' },
    ];
    const page = {
      goto: vi.fn(),
      evaluateOnNewDocument: vi.fn(),
      setViewport: vi.fn(),
      waitForSelector: vi.fn(),
      exposeFunction: vi.fn(),
      evaluate: vi.fn()
        .mockResolvedValueOnce(registry)
        .mockResolvedValueOnce([{ id: 't1', status: 'pass' }]),
    };
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, coverage: true });

    await runTests({ testFilters: ['shows error'] });

    // only the 2 evaluate calls happened (enumeration + run); coverage would be a 3rd
    expect(page.evaluate).toHaveBeenCalledTimes(2);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("prints the run-complete block last, with failure paths and errors", async () => {
    const testStatus = [
      { id: '1', status: 'pass' },
      { id: '2', status: 'fail', error: 'boom (at http://localhost:5173/form)' },
      { id: '3', status: 'skip' },
    ];
    const handlers = [
      { id: 's1', name: 'Form', type: 'suite' },
      { id: '1', name: 'should render', parent: 's1', type: 'test' },
      { id: '2', name: 'should submit form', parent: 's1', type: 'test' },
      { id: '3', name: 'should show error', parent: 's1', type: 'test' },
    ];
    const page = createMockPage({ handlers, testStatus });
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runTests();

    const logs = consoleSpy.mock.calls.map((c) => String(c[0]));
    const block = logs[logs.length - 1];
    expect(block.startsWith('--- Run complete ---')).toBe(true);
    expect(block).toContain('Passed: 1 | Failed: 1 | Skipped: 1');
    expect(block).toContain('× Form > should submit form');
    expect(block).toContain('boom (at http://localhost:5173/form)');
  });

  it("prints no config dump and no per-test tree chatter", async () => {
    const testStatus = [{ id: '1', status: 'pass' }];
    const handlers = [{ id: '1', name: 'test1', type: 'test' }];
    const page = createMockPage({ handlers, testStatus });
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runTests();

    const logs = consoleSpy.mock.calls.map((c) => String(c[0]));
    expect(logs.some((l) => l.startsWith('Configuration:'))).toBe(false);
    expect(logs.some((l) => l.startsWith('Starting TWD test runner'))).toBe(false);
    expect(logs.some((l) => l.startsWith('Tests to report'))).toBe(false);
    expect(logs.some((l) => l.startsWith('Browser closed'))).toBe(false);
    expect(logs.some((l) => l === 'Running 1 test(s)...')).toBe(true);
  });

  it("marks rethrown errors as reported", async () => {
    const page = createMockPage({ handlers: [], testStatus: [] });
    const bootError = new Error('net::ERR_CONNECTION_REFUSED at http://localhost:5173');
    page.goto = vi.fn().mockRejectedValue(bootError);
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(runTests()).rejects.toThrow('ERR_CONNECTION_REFUSED');

    expect(bootError.reported).toBe(true);
    const errors = errorSpy.mock.calls.map((c) => String(c[0]));
    expect(errors.some((e) => e.includes('Is your dev server running?'))).toBe(true);
    errorSpy.mockRestore();
  });

  it("falls back to printing the stack for unrecognized errors", async () => {
    const page = createMockPage({ handlers: [], testStatus: [] });
    const unknownError = new Error('weird boom');
    page.goto = vi.fn().mockRejectedValue(unknownError);
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(runTests()).rejects.toThrow('weird boom');

    const errors = errorSpy.mock.calls.map((c) => String(c[0]));
    expect(errors.some((e) => e.includes('Error running tests: weird boom'))).toBe(true);
    expect(errors.some((e) => e.includes('at '))).toBe(true);
    expect(errors.some((e) => e.includes('Is your dev server running?'))).toBe(false);
    errorSpy.mockRestore();
  });

  it("stops early once maxFailures is reached and reports Not run", async () => {
    const handlers = [
      { id: 's1', name: 'Suite', type: 'suite' },
      { id: 't1', name: 't1', parent: 's1', type: 'test' },
      { id: 't2', name: 't2', parent: 's1', type: 'test' },
      { id: 't3', name: 't3', parent: 's1', type: 'test' },
      { id: 't4', name: 't4', parent: 's1', type: 'test' },
      { id: 't5', name: 't5', parent: 's1', type: 'test' },
    ];
    const page = {
      goto: vi.fn(),
      evaluateOnNewDocument: vi.fn(),
      setViewport: vi.fn(),
      waitForSelector: vi.fn(),
      exposeFunction: vi.fn(),
      evaluate: vi.fn()
        .mockResolvedValueOnce(handlers)                             // enumeration
        .mockResolvedValueOnce([{ id: 't1', status: 'fail', error: 'a' }]) // chunk 1
        .mockResolvedValueOnce([{ id: 't2', status: 'fail', error: 'b' }]), // chunk 2
    };
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig,
      maxFailures: 2,
      chunkSize: 1,
    });

    const result = await runTests();

    expect(result).toBe(true);
    // enumeration + exactly 2 chunks (stopped; did NOT run t3..t5)
    expect(page.evaluate).toHaveBeenCalledTimes(3);
    const block = consoleSpy.mock.calls.map((c) => String(c[0])).at(-1);
    expect(block).toContain('Not run: 3');
    expect(block).toContain('Stopped early');
    expect(block).toContain('maxFailures=2');
  });

  it("runs every chunk when maxFailures is 0 (bail disabled)", async () => {
    const handlers = [
      { id: 's1', name: 'Suite', type: 'suite' },
      { id: 't1', name: 't1', parent: 's1', type: 'test' },
      { id: 't2', name: 't2', parent: 's1', type: 'test' },
      { id: 't3', name: 't3', parent: 's1', type: 'test' },
    ];
    const page = {
      goto: vi.fn(),
      evaluateOnNewDocument: vi.fn(),
      setViewport: vi.fn(),
      waitForSelector: vi.fn(),
      exposeFunction: vi.fn(),
      evaluate: vi.fn()
        .mockResolvedValueOnce(handlers)
        .mockResolvedValue([{ id: 'x', status: 'fail', error: 'boom' }]),
    };
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig,
      maxFailures: 0,
      chunkSize: 1,
    });

    await runTests();

    // enumeration + 3 chunks; never bailed
    expect(page.evaluate).toHaveBeenCalledTimes(4);
  });

  it("skips contract validation when the run stops early", async () => {
    const handlers = [
      { id: 's1', name: 'Suite', type: 'suite' },
      { id: 't1', name: 't1', parent: 's1', type: 'test' },
      { id: 't2', name: 't2', parent: 's1', type: 'test' },
    ];
    const page = {
      goto: vi.fn(),
      evaluateOnNewDocument: vi.fn(),
      setViewport: vi.fn(),
      waitForSelector: vi.fn(),
      exposeFunction: vi.fn(),
      evaluate: vi.fn()
        .mockResolvedValueOnce(handlers)
        .mockResolvedValueOnce([{ id: 't1', status: 'fail', error: 'a' }])
        .mockResolvedValueOnce([{ id: 't2', status: 'fail', error: 'b' }]),
    };
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig,
      maxFailures: 2,
      chunkSize: 1,
      contracts: [{ source: './openapi.json' }],
    });
    vi.mocked(loadContracts).mockResolvedValue([]);

    const result = await runTests();

    expect(result).toBe(true);
    expect(validateMocks).not.toHaveBeenCalled();
  });

  it("dedupes repeated suite-level skip entries across chunks", async () => {
    const handlers = [
      { id: 'sk', name: 'Skipped suite', type: 'suite' },
      { id: 't1', name: 't1', parent: 'sk', type: 'test' },
      { id: 't2', name: 't2', parent: 'sk', type: 'test' },
      { id: 't3', name: 't3', parent: 'sk', type: 'test' },
    ];
    const page = {
      goto: vi.fn(),
      evaluateOnNewDocument: vi.fn(),
      setViewport: vi.fn(),
      waitForSelector: vi.fn(),
      exposeFunction: vi.fn(),
      evaluate: vi.fn()
        .mockResolvedValueOnce(handlers)                        // enumeration
        .mockResolvedValueOnce([{ id: 'sk', status: 'skip' }])  // chunk 1 (t1)
        .mockResolvedValueOnce([{ id: 'sk', status: 'skip' }])  // chunk 2 (t2)
        .mockResolvedValueOnce([{ id: 'sk', status: 'skip' }]), // chunk 3 (t3)
    };
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, chunkSize: 1 });

    await runTests();

    const block = consoleSpy.mock.calls.map((c) => String(c[0])).at(-1);
    expect(block).toContain('Skipped: 1');
  });

  it("prints partial results when a chunk times out mid-run", async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handlers = [
      { id: 's1', name: 'Suite', type: 'suite' },
      { id: 't1', name: 't1', parent: 's1', type: 'test' },
      { id: 't2', name: 't2', parent: 's1', type: 'test' },
      { id: 't3', name: 't3', parent: 's1', type: 'test' },
    ];
    const timeoutError = new Error('Runtime.callFunctionOn timed out.');
    timeoutError.name = 'ProtocolError';
    const page = {
      goto: vi.fn(),
      evaluateOnNewDocument: vi.fn(),
      setViewport: vi.fn(),
      waitForSelector: vi.fn(),
      exposeFunction: vi.fn(),
      evaluate: vi.fn()
        .mockResolvedValueOnce(handlers)                             // enumeration
        .mockResolvedValueOnce([{ id: 't1', status: 'pass' }])       // chunk 1 ok
        .mockRejectedValueOnce(timeoutError),                        // chunk 2 hangs
    };
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig,
      chunkSize: 1,
    });

    await expect(runTests()).rejects.toThrow('timed out');

    const logs = consoleSpy.mock.calls.map((c) => String(c[0]));
    const block = logs.find((l) => l.startsWith('--- Run complete ---'));
    expect(block).toBeDefined();
    expect(block).toContain('Passed: 1');
    const errors = errorSpy.mock.calls.map((c) => String(c[0]));
    expect(errors.some((e) => e.includes('protocolTimeout'))).toBe(true);
    expect(browser.close).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("runTests recording", () => {
  const recordConfig = {
    enabled: true,
    dir: './twd-artifacts',
    filename: null,
    format: 'mp4',
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    fps: 30,
    speed: 1,
    hideSidebar: true,
    ffmpegPath: 'ffmpeg',
  };

  let consoleSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks keeps implementations, so drop anything a previous test
    // queued on these two: a leaked throwing probe or a leaked stat size would
    // silently change what every later test exercises.
    vi.mocked(assertFfmpegCapable).mockReset();
    vi.mocked(transcodeForPlayback).mockReset();
    vi.mocked(transcodeForPlayback).mockReturnValue({ ok: true });
    vi.mocked(fs.statSync).mockReset();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("injects the snapshot flags before navigating, never after", async () => {
    // Order is the whole point. evaluateOnNewDocument runs before any script on
    // the page, so matchLayout sees the flags on first read. Doing this after
    // goto would set them too late and every snapshot would silently skip.
    const page = createMockPage({
      handlers: [{ id: '1', name: 'test1', type: 'test' }],
      testStatus: [{ id: '1', status: 'pass' }],
    });
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));

    await runTests();

    expect(page.evaluateOnNewDocument).toHaveBeenCalled();
    expect(page.evaluateOnNewDocument.mock.invocationCallOrder[0])
      .toBeLessThan(page.goto.mock.invocationCallOrder[0]);
  });

  it("turns snapshots on and both modes off by default", async () => {
    const page = createMockPage({
      handlers: [{ id: '1', name: 'test1', type: 'test' }],
      testStatus: [{ id: '1', status: 'pass' }],
    });
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));

    await runTests();

    const [inject, flags] = page.evaluateOnNewDocument.mock.calls[0];
    expect(flags).toEqual({ update: false, ci: false });

    // The injected function is serialised into the browser, so run it here
    // against a stand-in global to see what it actually sets.
    expect(runInjected(inject, flags)).toEqual({ __TWD_SNAPSHOTS__: true });
    expect(runInjected(inject, { update: true, ci: false })).toEqual({
      __TWD_SNAPSHOTS__: true,
      __TWD_UPDATE_SNAPSHOTS__: true,
    });
    expect(runInjected(inject, { update: false, ci: true })).toEqual({
      __TWD_SNAPSHOTS__: true,
      __TWD_SNAPSHOT_CI__: true,
    });
  });

  it("passes --update-snapshots and --ci through to the page", async () => {
    const page = createMockPage({
      handlers: [{ id: '1', name: 'test1', type: 'test' }],
      testStatus: [{ id: '1', status: 'pass' }],
    });
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));

    await runTests({ updateSnapshots: true, ci: true });

    expect(page.evaluateOnNewDocument.mock.calls[0][1]).toEqual({ update: true, ci: true });
  });

  it("does not touch any recording API when recording is disabled", async () => {
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig });
    const page = createMockPage({
      handlers: [{ id: '1', name: 'test1', type: 'test' }],
      testStatus: [{ id: '1', status: 'pass' }],
    });
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));

    await runTests();

    expect(page.addStyleTag).not.toHaveBeenCalled();
    expect(page.screencast).not.toHaveBeenCalled();
    // The viewport is no longer a recording-only concern: every run gets an
    // explicit one so layout snapshots are reproducible.
    expect(page.setViewport).toHaveBeenCalledWith({ width: 1280, height: 800 });
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
    // stop() must resolve on a later tick, not synchronously. A synchronous
    // mock would keep this assertion green even if index.js dropped the await,
    // which in production is the un-awaited ffmpeg finalize that truncates the
    // file.
    const recorder = createMockRecorder(vi.fn(() => new Promise((resolve) => {
      setTimeout(() => {
        order.push('stop');
        resolve();
      }, 0);
    })));
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
    const recorder = createMockRecorder();
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

  it("stops the recorder exactly once when something throws after the success-path stop", async () => {
    // The window between the success-path stopRecorder() and browser.close():
    // coverage collection is the natural thing to throw in it. Without the
    // idempotency guard the catch path would stop an already-stopped recorder.
    const recorder = createMockRecorder();
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig,
      coverage: true,
      record: recordConfig,
    });
    const page = createMockPage({
      handlers: [{ id: '1', name: 'test1', type: 'test' }],
      recorder,
    });
    page.evaluate = vi.fn()
      .mockResolvedValueOnce([{ id: '1', name: 'test1', type: 'test' }]) // enumeration
      .mockResolvedValueOnce([{ id: '1', status: 'pass' }])              // chunk run
      .mockRejectedValueOnce(new Error('coverage boom'));                // coverage read
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(runTests()).rejects.toThrow('coverage boom');

    expect(recorder.stop).toHaveBeenCalledTimes(1);
  });

  it("warns instead of claiming success when the artifact is empty", async () => {
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, record: recordConfig });
    vi.mocked(fs.statSync).mockReturnValue({ size: 0 });
    const page = createMockPage({
      handlers: [{ id: '1', name: 'test1', type: 'test' }],
      testStatus: [{ id: '1', status: 'pass' }],
    });
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await runTests();

    const logs = consoleSpy.mock.calls.map((c) => String(c[0]));
    expect(logs.some((l) => l.startsWith('Recorded'))).toBe(false);
    const warnings = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(warnings.some((w) => w.includes('empty file'))).toBe(true);
    expect(warnings.some((w) => w.includes('repaints'))).toBe(true);
  });

  it("warns when the artifact was never created at all", async () => {
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, record: recordConfig });
    vi.mocked(fs.statSync).mockImplementation(() => {
      const err = new Error('ENOENT: no such file or directory');
      err.code = 'ENOENT';
      throw err;
    });
    const page = createMockPage({
      handlers: [{ id: '1', name: 'test1', type: 'test' }],
      testStatus: [{ id: '1', status: 'pass' }],
    });
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await runTests();

    const logs = consoleSpy.mock.calls.map((c) => String(c[0]));
    expect(logs.some((l) => l.startsWith('Recorded'))).toBe(false);
    const warnings = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(warnings.some((w) => w.includes('empty file'))).toBe(true);
  });

  it("reports the recorded artifact when the file has bytes", async () => {
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, record: recordConfig });
    vi.mocked(fs.statSync).mockReturnValue({ size: 17081 });
    const page = createMockPage({
      handlers: [{ id: '1', name: 'test1', type: 'test' }],
      testStatus: [{ id: '1', status: 'pass' }],
    });
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await runTests();

    const logs = consoleSpy.mock.calls.map((c) => String(c[0]));
    expect(logs.some((l) => l.startsWith('Recorded 1 test(s) to'))).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("runTests when the encoder dies", () => {
  const recordConfig = {
    enabled: true,
    dir: './twd-artifacts',
    filename: null,
    format: 'mp4',
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    fps: 30,
    speed: 1,
    hideSidebar: true,
    ffmpegPath: 'ffmpeg',
  };

  let consoleSpy;
  let errorSpy;
  let warnSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertFfmpegCapable).mockReset();
    vi.mocked(transcodeForPlayback).mockReset();
    vi.mocked(transcodeForPlayback).mockReturnValue({ ok: true });
    vi.mocked(fs.statSync).mockReset();
    vi.mocked(fs.statSync).mockReturnValue({ size: 17081 });
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, record: recordConfig });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Kills ffmpeg while the tests are still running, the way a rejected argument
  // does: stderr first, then the stream ends and stop() can never resolve again.
  function pageWithDyingEncoder({ stderr = 'Unable to parse option value "hybrid_fragmented"' } = {}) {
    const recorder = createMockRecorder(vi.fn(() => new Promise(() => {})));
    const page = createMockPage({ handlers: [{ id: '1', name: 'test1', type: 'test' }] });
    page.evaluate = vi.fn()
      .mockImplementationOnce(async () => [{ id: '1', name: 'test1', type: 'test' }])
      .mockImplementationOnce(async () => {
        const { logger } = vi.mocked(puppeteer.launch).mock.calls[0][0];
        logger('puppeteer:ffmpeg')(stderr);
        recorder.emit('end');
        return [{ id: '1', status: 'pass' }];
      });
    page.screencast = vi.fn().mockResolvedValue(recorder);
    return { page, recorder };
  }

  it("hands puppeteer a logger while recording, so ffmpeg's stderr is reachable", async () => {
    const page = createMockPage({
      handlers: [{ id: '1', name: 'test1', type: 'test' }],
      testStatus: [{ id: '1', status: 'pass' }],
    });
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));

    await runTests();

    expect(puppeteer.launch).toHaveBeenCalledWith(
      expect.objectContaining({ logger: expect.any(Function) })
    );
  });

  it("returns without hanging when stop() can never resolve", async () => {
    // The regression this whole change exists for. puppeteer's stop() waits on a
    // 'close' event that already fired, so awaiting it never returns; the run
    // that found this burned a CI job's remaining minutes here after every test
    // had already passed. If runTests awaits it again, this test times out.
    const { page } = pageWithDyingEncoder();
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));

    await runTests();
  });

  it("fails the run when the encoder died, even though every test passed", async () => {
    const { page } = pageWithDyingEncoder();
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));

    await expect(runTests()).resolves.toBe(true);
  });

  it("prints ffmpeg's own error instead of leaving it to a wrapper script", async () => {
    const { page } = pageWithDyingEncoder({ stderr: "Unknown encoder 'libvpx-vp9'" });
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));

    await runTests();

    const printed = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toMatch(/Unknown encoder 'libvpx-vp9'/);
  });

  it("does not claim a recording it did not finish", async () => {
    const { page } = pageWithDyingEncoder();
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));

    await runTests();

    const logs = consoleSpy.mock.calls.map((c) => String(c[0]));
    expect(logs.some((l) => l.startsWith('Recorded'))).toBe(false);
  });

  it("does not convert a recording whose encoder died", async () => {
    const { page } = pageWithDyingEncoder();
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));

    await runTests();

    expect(transcodeForPlayback).not.toHaveBeenCalled();
  });

  it("still surfaces ffmpeg's error when something else throws afterwards", async () => {
    // A dead encoder can disrupt the run that follows it. Reporting only the
    // downstream error would leave the actual first cause unmentioned.
    const recorder = createMockRecorder(vi.fn(() => new Promise(() => {})));
    const page = createMockPage({ handlers: [{ id: '1', name: 'test1', type: 'test' }] });
    page.evaluate = vi.fn()
      .mockImplementationOnce(async () => [{ id: '1', name: 'test1', type: 'test' }])
      .mockImplementationOnce(async () => {
        const { logger } = vi.mocked(puppeteer.launch).mock.calls[0][0];
        logger('puppeteer:ffmpeg')('Error while filtering: Invalid argument');
        recorder.emit('end');
        throw new Error('Navigation timeout');
      });
    page.screencast = vi.fn().mockResolvedValue(recorder);
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));

    await expect(runTests()).rejects.toThrow('Navigation timeout');

    const printed = errorSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toMatch(/Error while filtering: Invalid argument/);
    expect(printed).toMatch(/Navigation timeout/);
  });

  it("still closes the browser after a dead encoder", async () => {
    const { page } = pageWithDyingEncoder();
    const browser = createMockBrowser(page);
    puppeteer.launch.mockResolvedValue(browser);

    await runTests();

    expect(browser.close).toHaveBeenCalled();
  });
});

describe("runTests recording playback conversion", () => {
  const recordConfig = {
    enabled: true,
    dir: './twd-artifacts',
    filename: null,
    format: 'mp4',
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    fps: 30,
    speed: 1,
    hideSidebar: true,
    ffmpegPath: 'ffmpeg',
  };

  let consoleSpy;
  let warnSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertFfmpegCapable).mockReset();
    vi.mocked(transcodeForPlayback).mockReset();
    vi.mocked(transcodeForPlayback).mockReturnValue({ ok: true });
    vi.mocked(fs.statSync).mockReset();
    vi.mocked(fs.statSync).mockReturnValue({ size: 17081 });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function passingPage() {
    return createMockPage({
      handlers: [{ id: '1', name: 'test1', type: 'test' }],
      testStatus: [{ id: '1', status: 'pass' }],
    });
  }

  it("converts the finished mp4 so it plays outside Chrome", async () => {
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, record: recordConfig });
    puppeteer.launch.mockResolvedValue(createMockBrowser(passingPage()));

    await runTests();

    expect(transcodeForPlayback).toHaveBeenCalledWith(
      'ffmpeg',
      expect.stringContaining('test1.mp4')
    );
  });

  it("reports the size after conversion, not the size before it", async () => {
    // The conversion replaces the file and measurably shrinks it, so a size read
    // before the swap would report bytes that are no longer on disk.
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, record: recordConfig });
    vi.mocked(fs.statSync)
      .mockReturnValueOnce({ size: 202805 })
      .mockReturnValue({ size: 49222 });
    puppeteer.launch.mockResolvedValue(createMockBrowser(passingPage()));

    await runTests({ shard: { index: 1, total: 1 } });

    const written = vi.mocked(fs.writeFileSync).mock.calls.map((c) => String(c[1])).join('');
    expect(written).toContain('49222');
  });

  it("keeps the recording and warns when conversion is not possible", async () => {
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, record: recordConfig });
    vi.mocked(transcodeForPlayback).mockReturnValue({ ok: false, reason: "Unknown encoder 'libx264'" });
    puppeteer.launch.mockResolvedValue(createMockBrowser(passingPage()));

    await expect(runTests()).resolves.toBe(false);

    const warnings = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warnings).toMatch(/libx264/);
    expect(warnings).toMatch(/VLC/);
    const logs = consoleSpy.mock.calls.map((c) => String(c[0]));
    expect(logs.some((l) => l.startsWith('Recorded'))).toBe(true);
  });

  it("does not convert an empty recording", async () => {
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, record: recordConfig });
    vi.mocked(fs.statSync).mockReturnValue({ size: 0 });
    puppeteer.launch.mockResolvedValue(createMockBrowser(passingPage()));

    await runTests();

    expect(transcodeForPlayback).not.toHaveBeenCalled();
  });

  it("leaves webm alone, where VP9 is the expected codec", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig,
      record: { ...recordConfig, format: 'webm' },
    });
    puppeteer.launch.mockResolvedValue(createMockBrowser(passingPage()));

    await runTests();

    expect(transcodeForPlayback).not.toHaveBeenCalled();
  });
});

describe("runTests ffmpeg probe", () => {
  const recordConfig = {
    enabled: true,
    dir: './twd-artifacts',
    filename: null,
    format: 'mp4',
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    fps: 30,
    speed: 1,
    hideSidebar: true,
    ffmpegPath: 'ffmpeg',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertFfmpegCapable).mockReset();
    vi.mocked(transcodeForPlayback).mockReset();
    vi.mocked(transcodeForPlayback).mockReturnValue({ ok: true });
    vi.mocked(fs.statSync).mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("probes for ffmpeg when recording is enabled", async () => {
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, record: recordConfig });
    const page = createMockPage({
      handlers: [{ id: '1', name: 'test1', type: 'test' }],
      testStatus: [{ id: '1', status: 'pass' }],
    });
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));

    await runTests();

    expect(assertFfmpegCapable).toHaveBeenCalledWith('ffmpeg', 'mp4');
  });

  it("passes a configured ffmpegPath to the probe", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig,
      record: { ...recordConfig, ffmpegPath: '/opt/homebrew/bin/ffmpeg' },
    });
    const page = createMockPage({
      handlers: [{ id: '1', name: 'test1', type: 'test' }],
      testStatus: [{ id: '1', status: 'pass' }],
    });
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));

    await runTests();

    expect(assertFfmpegCapable).toHaveBeenCalledWith('/opt/homebrew/bin/ffmpeg', 'mp4');
  });

  it("does not probe for ffmpeg when recording is disabled", async () => {
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig });
    const page = createMockPage({
      handlers: [{ id: '1', name: 'test1', type: 'test' }],
      testStatus: [{ id: '1', status: 'pass' }],
    });
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));

    await runTests();

    expect(assertFfmpegCapable).not.toHaveBeenCalled();
  });

  it("fails before launching the browser when ffmpeg is missing", async () => {
    // The whole point of the pre-flight probe: no wasted launch + navigation
    // before the user learns ffmpeg is not installed.
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, record: recordConfig });
    vi.mocked(assertFfmpegCapable).mockImplementation(() => {
      throw new Error('Recording requires ffmpeg, which was not found.');
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(runTests()).rejects.toThrow('Recording requires ffmpeg');

    expect(puppeteer.launch).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("runTests pre-roll and post-roll", () => {
  const rollConfig = {
    enabled: true,
    dir: './twd-artifacts',
    filename: null,
    format: 'mp4',
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    fps: 30,
    speed: 1,
    preRoll: 250,
    postRoll: 500,
    hideSidebar: true,
    ffmpegPath: 'ffmpeg',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // An earlier describe's restoreAllMocks puts these back to their real
    // implementations, so neuter them again or the probe actually shells out
    // and holdFinalFrame actually drives page.evaluate.
    vi.mocked(assertFfmpegCapable).mockReset();
    vi.mocked(holdOpeningFrame).mockReset();
    vi.mocked(holdFinalFrame).mockReset();
    vi.mocked(fs.statSync).mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function passingPage(recorder) {
    return createMockPage({
      handlers: [{ id: '1', name: 'test1', type: 'test' }],
      testStatus: [{ id: '1', status: 'pass' }],
      recorder,
    });
  }

  it("holds the opening frame after starting the recorder", async () => {
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, record: rollConfig });
    const page = passingPage();
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));

    await runTests();

    expect(holdOpeningFrame).toHaveBeenCalledWith(250);
  });

  it("holds the final frame before the recorder is stopped", async () => {
    const order = [];
    vi.mocked(holdFinalFrame).mockImplementation(() => { order.push('hold'); });
    const recorder = createMockRecorder(vi.fn(() => new Promise((resolve) => setTimeout(() => {
      order.push('stop');
      resolve();
    }, 0))));
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, record: rollConfig });
    const page = passingPage(recorder);
    const browser = createMockBrowser(page);
    browser.close = vi.fn(() => { order.push('close'); });
    puppeteer.launch.mockResolvedValue(browser);

    await runTests();

    // The hold is what gets the last test's result into the video, so it has to
    // land before stop(), and stop() before close().
    expect(order).toEqual(['hold', 'stop', 'close']);
    expect(holdFinalFrame).toHaveBeenCalledWith(page, 500);
  });

  it("does neither when recording is disabled", async () => {
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig });
    const page = passingPage();
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));

    await runTests();

    expect(holdOpeningFrame).not.toHaveBeenCalled();
    expect(holdFinalFrame).not.toHaveBeenCalled();
  });
});

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
    vi.mocked(assertFfmpegCapable).mockReset();
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

  it("degrades to an unpaced recording when twd-js has no pacing hook", async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, record: paceConfig });
    // An older twd-js: the in-page function returns null rather than a number.
    const page = pacedPage(null);
    puppeteer.launch.mockResolvedValue(createMockBrowser(page));

    const hasFailures = await runTests();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('twd-js 1.9.0 or newer'));
    // The run still completes and still records; only the pacing is lost.
    expect(hasFailures).toBe(false);
  });

});

describe('runTests sharding', () => {
  function fourTests() {
    return {
      handlers: [
        { id: '1', name: 'a', type: 'test' },
        { id: '2', name: 'b', type: 'test' },
        { id: '3', name: 'c', type: 'test' },
        { id: '4', name: 'd', type: 'test' },
      ],
      testStatus: [{ id: '2', status: 'pass' }, { id: '4', status: 'pass' }],
    };
  }

  function runJson() {
    const call = vi.mocked(fs.writeFileSync).mock.calls
      .find(([file]) => String(file).endsWith('run.json'));
    return call ? JSON.parse(call[1]) : null;
  }

  // runJson() and the not.toHaveBeenCalled() assertions read fs call history, so
  // this block cannot inherit another describe's. loadConfig has to be re-stubbed
  // too: clearAllMocks keeps implementations, so without this the previous block's
  // recording-enabled config (with a pace) leaks in.
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig });
    vi.mocked(assertFfmpegCapable).mockReset();
    vi.mocked(transcodeForPlayback).mockReset();
    vi.mocked(transcodeForPlayback).mockReturnValue({ ok: true });
    vi.mocked(fs.statSync).mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Round-robin: shard 2 of 2 takes the odd indices, i.e. the 2nd and 4th ids.
  it('runs only its round-robin slice', async () => {
    const { handlers, testStatus } = fourTests();
    const page = createMockPage({ handlers, testStatus });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));

    await runTests({ shard: { index: 2, total: 2 } });

    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 2, ['2', '4']);
  });

  it('writes a run report to the default report dir', async () => {
    const { handlers, testStatus } = fourTests();
    const page = createMockPage({ handlers, testStatus });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));

    await runTests({ shard: { index: 2, total: 2 } });

    expect(fs.mkdirSync).toHaveBeenCalledWith('./.twd/run', { recursive: true });
    const report = runJson();
    expect(report.schemaVersion).toBe(REPORT_SCHEMA_VERSION);
    expect(report.shards[0]).toMatchObject({ index: 2, total: 2, executed: 2 });
    expect(report.discovery.totalTests).toBe(4);
    expect(report.tests.map((t) => t.id)).toEqual(['2', '4']);
  });

  // path is resolved here, in the shard that ran the test, because twd-js ids
  // are random per page load: shard 2's ids do not exist in the handler map a
  // merged report keeps, so the merged summary could not name these tests
  // otherwise. index is the cross-shard identity — the same number in every
  // shard, unlike the id.
  it('stamps each result with its resolved path and its position in the order', async () => {
    const { handlers, testStatus } = fourTests();
    const page = createMockPage({ handlers, testStatus });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));

    await runTests({ shard: { index: 2, total: 2 } });

    expect(runJson().tests).toEqual([
      { id: '2', status: 'pass', path: 'b', index: 1 },
      { id: '4', status: 'pass', path: 'd', index: 3 },
    ]);
  });

  // The fingerprint is over paths, not ids, so two shards of the same suite
  // agree on it even though their browsers minted entirely different ids. With
  // ids it could never match and merge rejected every correct sharded run.
  it('fingerprints identically across shards whose ids differ', async () => {
    const { handlers, testStatus } = fourTests();
    const first = createMockPage({ handlers, testStatus });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(first));
    await runTests({ shard: { index: 1, total: 2 } });
    const shardOne = runJson().discovery.fingerprint;

    vi.clearAllMocks();
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig });
    // Same suite, same order, all-new ids — exactly what a second browser does.
    const relabeled = handlers.map((h) => ({ ...h, id: `x${h.id}` }));
    const second = createMockPage({ handlers: relabeled, testStatus: [] });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(second));
    await runTests({ shard: { index: 2, total: 2 } });

    expect(runJson().discovery.fingerprint).toBe(shardOne);
  });

  it('honors --report-dir', async () => {
    const { handlers, testStatus } = fourTests();
    const page = createMockPage({ handlers, testStatus });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));

    await runTests({ shard: { index: 1, total: 1 }, reportDir: './out' });

    expect(fs.mkdirSync).toHaveBeenCalledWith('./out', { recursive: true });
  });

  it('writes no report when not sharded', async () => {
    const { handlers, testStatus } = fourTests();
    const page = createMockPage({ handlers, testStatus });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));

    await runTests();

    expect(runJson()).toBeNull();
  });

  // 3 tests across 4 shards leaves the fourth with nothing to run. It must
  // still write a valid report, or merge sees a gap it cannot explain.
  it('writes a valid empty report when its slice is empty', async () => {
    const handlers = [
      { id: '1', name: 'a', type: 'test' },
      { id: '2', name: 'b', type: 'test' },
      { id: '3', name: 'c', type: 'test' },
    ];
    const page = createMockPage({ handlers, testStatus: [] });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));

    const hasFailures = await runTests({ shard: { index: 4, total: 4 } });

    expect(hasFailures).toBe(false);
    const report = runJson();
    expect(report.tests).toEqual([]);
    expect(report.shards[0]).toMatchObject({ index: 4, total: 4, executed: 0, failed: 0 });
    // The fingerprint still covers the whole suite, so an empty shard merges
    // cleanly with the three that ran something.
    expect(report.discovery.totalTests).toBe(3);
  });

  // Filters resolve first, then the filtered list is sharded. A filtered run's
  // coverage is a misleading project-wide number, sharded or not.
  it('skips coverage when a filter is combined with a shard', async () => {
    const { handlers, testStatus } = fourTests();
    const page = createMockPage({ handlers, testStatus });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, coverage: true });

    await runTests({ shard: { index: 1, total: 2 }, testFilters: ['a'] });

    const files = vi.mocked(fs.writeFileSync).mock.calls.map(([f]) => String(f));
    expect(files.some((f) => f.endsWith('coverage.json'))).toBe(false);
    expect(runJson().shards[0].coverageFile).toBeNull();
    expect(runJson().selection.filters).toEqual(['a']);
  });

  // Filters resolve first, so the shards divide the filtered list, and that is
  // the count executed + notRun has to add up to. Recording the unfiltered
  // total instead made merge print a shard-slicing warning on a correct run.
  it('records the filtered count as the selection the shards divided', async () => {
    const { handlers } = fourTests();
    const page = createMockPage({ handlers, testStatus: [{ id: '1', status: 'pass' }] });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));

    await runTests({ shard: { index: 1, total: 2 }, testFilters: ['a'] });

    const report = runJson();
    expect(report.discovery.totalTests).toBe(4);
    expect(report.selection.selectedTests).toBe(1);
    expect(report.shards[0].executed + report.shards[0].notRun)
      .toBe(report.selection.selectedTests);
  });
});

describe('runTests non-regression: non-sharded behavior is unchanged', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig });
    vi.mocked(assertFfmpegCapable).mockReset();
    vi.mocked(transcodeForPlayback).mockReset();
    vi.mocked(transcodeForPlayback).mockReturnValue({ ok: true });
    vi.mocked(fs.statSync).mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The !hasFailures coverage gate is relaxed only for sharded runs. A plain
  // failing run must still write nothing, exactly as in 1.4.0.
  it('writes no coverage when a non-sharded run fails', async () => {
    const handlers = [{ id: '1', name: 'a', type: 'test' }];
    const page = createMockPage({ handlers, testStatus: [{ id: '1', status: 'fail', error: 'boom' }] });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, coverage: true });

    await runTests();

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  // The successful coverage write. Splitting its if/else apart is the most
  // delicate edit in the sharding change and nothing else exercised this block,
  // so pin the destination: nyc reads .nyc_output/out.json by default.
  it('still writes coverage to .nyc_output/out.json when a non-sharded run passes', async () => {
    const handlers = [{ id: '1', name: 'a', type: 'test' }];
    const page = createMockPage({ handlers, testStatus: [{ id: '1', status: 'pass' }] });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, coverage: true });

    await runTests();

    const files = vi.mocked(fs.writeFileSync).mock.calls.map(([f]) => String(f));
    expect(files).toHaveLength(1);
    expect(files[0].includes('.nyc_output')).toBe(true);
    expect(files[0].endsWith('out.json')).toBe(true);
  });

  // Likewise the early-stop contract skip.
  it('still skips contract validation when a non-sharded run stops early', async () => {
    const handlers = [{ id: '1', name: 'a', type: 'test' }];
    const page = createMockPage({ handlers, testStatus: [{ id: '1', status: 'fail', error: 'boom' }] });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig, maxFailures: 1, contracts: [{ source: 'api.json' }],
    });
    vi.mocked(loadContracts).mockResolvedValue([]);

    await runTests();

    expect(validateMocks).not.toHaveBeenCalled();
  });

  // The twd-js version hint gained a `&& !sharded` gate. A plain run with
  // contracts configured and nothing collected really may be running a twd-js
  // that cannot collect, so it must still say so.
  it('still hints at twd-js when a non-sharded run collects no mocks', async () => {
    const log = vi.spyOn(console, 'log');
    const handlers = [{ id: '1', name: 'a', type: 'test' }];
    const page = createMockPage({ handlers, testStatus: [{ id: '1', status: 'pass' }] });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig, contracts: [{ source: 'api.json' }],
    });
    vi.mocked(loadContracts).mockResolvedValue([]);
    vi.mocked(validateMocks).mockReturnValue({ results: [], skipped: [] });
    vi.mocked(printContractReport).mockReturnValue(false);

    await runTests();

    expect(log.mock.calls.flat().join('\n')).toContain('No mocks collected');
  });

  // The markdown report gained a `&& !sharded` gate. A plain run must still
  // write it, and this is the only test that executes that block at all.
  it('still writes the contract markdown report on a non-sharded run', async () => {
    const handlers = [{ id: '1', name: 'a', type: 'test' }];
    const page = createMockPage({ handlers, testStatus: [{ id: '1', status: 'pass' }] });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig,
      contracts: [{ source: 'api.json' }],
      contractReportPath: './contract-report.md',
    });
    vi.mocked(loadContracts).mockResolvedValue([]);
    vi.mocked(validateMocks).mockReturnValue({ results: [], skipped: [] });
    vi.mocked(printContractReport).mockReturnValue(false);

    await runTests();

    const files = vi.mocked(fs.writeFileSync).mock.calls.map(([f]) => String(f));
    expect(files.some((f) => f.endsWith('contract-report.md'))).toBe(true);
  });
});

describe('runTests sharded behavior changes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig });
    vi.mocked(assertFfmpegCapable).mockReset();
    vi.mocked(transcodeForPlayback).mockReset();
    vi.mocked(transcodeForPlayback).mockReturnValue({ ok: true });
    vi.mocked(fs.statSync).mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes coverage for a sharded run that fails', async () => {
    const handlers = [{ id: '1', name: 'a', type: 'test' }];
    const page = createMockPage({ handlers, testStatus: [{ id: '1', status: 'fail', error: 'boom' }] });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig, coverage: true });

    await runTests({ shard: { index: 1, total: 1 } });

    const files = vi.mocked(fs.writeFileSync).mock.calls.map(([f]) => String(f));
    expect(files.some((f) => f.endsWith('coverage.json'))).toBe(true);
    // Never the path nyc reads by default: a shard's partial coverage there
    // would masquerade as the whole run's.
    expect(files.some((f) => f.includes('.nyc_output'))).toBe(false);
  });

  // Every shard would overwrite the others with a fraction of the picture, so
  // the markdown report is merge's job. The run.json still gets written.
  it('writes no contract markdown report when sharded', async () => {
    const handlers = [{ id: '1', name: 'a', type: 'test' }];
    const page = createMockPage({ handlers, testStatus: [{ id: '1', status: 'pass' }] });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig,
      contracts: [{ source: 'api.json' }],
      contractReportPath: './contract-report.md',
    });
    vi.mocked(loadContracts).mockResolvedValue([]);
    vi.mocked(validateMocks).mockReturnValue({ results: [], skipped: [] });
    vi.mocked(printContractReport).mockReturnValue(false);

    await runTests({ shard: { index: 1, total: 1 } });

    const files = vi.mocked(fs.writeFileSync).mock.calls.map(([f]) => String(f));
    expect(files.some((f) => f.endsWith('contract-report.md'))).toBe(false);
    expect(files.some((f) => f.endsWith('run.json'))).toBe(true);
  });

  // A shard whose slice exercised no mocks — and any shard with an empty slice —
  // collects nothing, which is normal. Printing the twd-js version hint there
  // advertises a problem that does not exist, on the happy path of every
  // sharded CI run.
  it('does not hint at twd-js when a sharded run collects no mocks', async () => {
    const log = vi.spyOn(console, 'log');
    const handlers = [{ id: '1', name: 'a', type: 'test' }];
    const page = createMockPage({ handlers, testStatus: [{ id: '1', status: 'pass' }] });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig, contracts: [{ source: 'api.json' }],
    });
    vi.mocked(loadContracts).mockResolvedValue([]);
    vi.mocked(validateMocks).mockReturnValue({ results: [], skipped: [] });
    vi.mocked(printContractReport).mockReturnValue(false);

    await runTests({ shard: { index: 1, total: 2 } });

    expect(log.mock.calls.flat().join('\n')).not.toContain('No mocks collected');
    // Still validated what it did collect — only the hint is suppressed.
    expect(validateMocks).toHaveBeenCalled();
  });

  it('validates contracts on a sharded early stop and marks them partial', async () => {
    const handlers = [{ id: '1', name: 'a', type: 'test' }];
    const page = createMockPage({ handlers, testStatus: [{ id: '1', status: 'fail', error: 'boom' }] });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig, maxFailures: 1, contracts: [{ source: 'api.json' }],
    });
    vi.mocked(loadContracts).mockResolvedValue([]);
    vi.mocked(validateMocks).mockReturnValue({ results: [{ alias: 'a' }], skipped: [] });
    vi.mocked(printContractReport).mockReturnValue(false);

    await runTests({ shard: { index: 1, total: 1 } });

    expect(validateMocks).toHaveBeenCalled();
    const call = vi.mocked(fs.writeFileSync).mock.calls
      .find(([file]) => String(file).endsWith('run.json'));
    const report = JSON.parse(call[1]);
    expect(report.contracts).toMatchObject({ configured: true, partial: true });
    expect(report.contracts.results).toEqual([{ alias: 'a' }]);
  });
});

// The in-page onFail is serialised into the browser, so the suite never runs it
// by mocking page.evaluate. These drive the real callback directly against a
// stub runner: it is the only place the diagnostics hand-off is observable.
describe("in-page onFail diagnostics hand-off", () => {
  let savedWindow;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    savedWindow = global.window;
  });

  afterEach(() => {
    global.window = savedWindow;
    vi.restoreAllMocks();
  });

  // Runs the function twd-cli hands to page.evaluate, with a stub
  // window.__testRunner that fails one test.
  async function runInPageFn(failingTest) {
    const handlers = [{ id: 't1', name: 'test1', type: 'test' }];
    const page = createMockPage({ handlers, testStatus: [] });
    vi.mocked(puppeteer.launch).mockResolvedValue(createMockBrowser(page));
    await runTests();

    // call 0 is the enumeration pass; call 1 is the first chunk run.
    const [inPageFn, retryCount, chunkIds] = page.evaluate.mock.calls[1];

    global.window = {
      location: { href: 'http://localhost:5173/cg-1/settings/catalog' },
      __testRunner: class {
        constructor(callbacks) { this.callbacks = callbacks; }
        async runByIds() { this.callbacks.onFail(failingTest, new Error('boom')); }
      },
    };

    return inPageFn(retryCount, chunkIds);
  }

  it("carries the raw snapshot out on the failure entry", async () => {
    const diagnostics = {
      location: '/cg-1/settings/catalog',
      mockRules: { registered: 7, triggered: 6, untriggered: ['catalog'] },
    };

    const result = await runInPageFn({ id: 't1', diagnostics });

    expect(result).toEqual([{
      id: 't1',
      status: 'fail',
      diagnostics,
      error: 'boom (at http://localhost:5173/cg-1/settings/catalog)',
    }]);
  });

  // twd-js 1.9.0 and earlier hang nothing off the handler. The entry must still
  // be well-formed, and the error text unchanged.
  it("leaves the entry intact when twd-js sends no snapshot", async () => {
    const result = await runInPageFn({ id: 't1' });

    expect(result[0].diagnostics).toBeUndefined();
    expect(result[0].error).toBe('boom (at http://localhost:5173/cg-1/settings/catalog)');
  });
});
