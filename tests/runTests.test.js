import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runTests } from "../src/index.js";

vi.mock('fs');
vi.mock('puppeteer');
vi.mock('twd-js/runner-ci', () => ({
  reportResults: vi.fn(),
}));
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
import { reportResults } from 'twd-js/runner-ci';
import { loadConfig } from '../src/config.js';
import { loadContracts, validateMocks } from '../src/contracts.js';
import { printContractReport } from '../src/contractReport.js';

function createMockPage(evaluateResult) {
  return {
    goto: vi.fn(),
    waitForSelector: vi.fn(),
    evaluate: vi.fn().mockResolvedValue(evaluateResult),
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
};

describe("runTests", () => {
  let consoleSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadConfig).mockReturnValue({ ...defaultMockConfig });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'time').mockImplementation(() => {});
    vi.spyOn(console, 'timeEnd').mockImplementation(() => {});
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

    // page.evaluate is called with (fn, retryCount)
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 3);
  });

  it("should log retry summary when tests were retried", async () => {
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

    const logs = consoleSpy.mock.calls.map(c => c[0]);
    expect(logs).toContain('\n⟳ Retried tests:');
    expect(logs.some(l => l.includes('flaky test') && l.includes('attempt 2'))).toBe(true);
    expect(logs.some(l => l.includes('1 test(s) required retries'))).toBe(true);
  });

  it("should not log retry summary when no tests were retried", async () => {
    const testStatus = [{ id: '1', status: 'pass' }];
    const handlers = [{ id: '1', name: 'test1', type: 'test' }];
    const page = createMockPage({ handlers, testStatus });
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runTests();

    const logs = consoleSpy.mock.calls.map(c => c[0]);
    expect(logs).not.toContain('\n⟳ Retried tests:');
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
      // Drive the registered __twdCollectMock callback from inside page.evaluate,
      // mirroring how a real browser test would trigger it.
      evaluate: vi.fn().mockImplementation(async () => {
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
        return { handlers, testStatus };
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

  it("delegates to runParallel and does NOT launch a single-page serial flow when parallel=true", async () => {
    // When parallel mode is on, runTests should call runParallel (which
    // itself launches puppeteer with createBrowserContext). The serial code
    // path uses browser.newPage() on the default context. If parallel
    // dispatch works, page.evaluate should never be called via the serial
    // newPage() path — evidenced by puppeteer.launch being invoked exactly
    // once with args including the anti-throttle flags.
    const browser = {
      createBrowserContext: vi.fn().mockImplementation(() => ({
        newPage: vi.fn().mockResolvedValue({
          goto: vi.fn(),
          waitForSelector: vi.fn(),
          exposeFunction: vi.fn(),
          evaluate: vi.fn()
            .mockResolvedValueOnce({ handlers: [], testStatus: [] })
            .mockResolvedValueOnce(null),
        }),
        close: vi.fn(),
      })),
      newPage: vi.fn(), // serial path would call this — we assert it was NOT called
      close: vi.fn(),
    };
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    vi.mocked(loadConfig).mockReturnValue({
      ...defaultMockConfig,
      parallel: true,
    });

    await runTests();

    expect(browser.newPage).not.toHaveBeenCalled();
    expect(browser.createBrowserContext).toHaveBeenCalledTimes(2);

    const launchArgs = vi.mocked(puppeteer.launch).mock.calls[0][0].args;
    expect(launchArgs).toContain('--disable-renderer-backgrounding');
  });

  it("runs the serial path when parallel is absent (default false)", async () => {
    const testStatus = [{ id: '1', status: 'pass' }];
    const handlers = [{ id: '1', name: 'test1', type: 'test' }];
    const page = createMockPage({ handlers, testStatus });
    const browser = createMockBrowser(page);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    // defaultMockConfig has no `parallel` field — absent should mean serial.

    await runTests();

    expect(browser.newPage).toHaveBeenCalled();
    // Anti-throttle flags are a parallel-only behavior — NOT in the serial launch.
    const launchArgs = vi.mocked(puppeteer.launch).mock.calls[0][0].args;
    expect(launchArgs).not.toContain('--disable-renderer-backgrounding');
  });
});
