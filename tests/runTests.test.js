import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runTests } from "../src/index.js";

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

import fs from 'fs';
import puppeteer from 'puppeteer';
import { loadConfig } from '../src/config.js';
import { loadContracts, validateMocks } from '../src/contracts.js';
import { printContractReport } from '../src/contractReport.js';

function createMockPage({ handlers = [], testStatus = [] } = {}) {
  return {
    goto: vi.fn(),
    waitForSelector: vi.fn(),
    evaluate: vi.fn()
      .mockResolvedValueOnce(handlers) // enumeration pass returns handler metadata
      .mockResolvedValue(testStatus),  // each chunk run returns its testStatus array
    exposeFunction: vi.fn(),
  };
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
