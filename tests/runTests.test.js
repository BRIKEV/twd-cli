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

import fs from 'fs';
import puppeteer from 'puppeteer';
import { reportResults } from 'twd-js/runner-ci';
import { loadConfig } from '../src/config.js';

function createMockPage(evaluateResult) {
  return {
    goto: vi.fn(),
    waitForSelector: vi.fn(),
    evaluate: vi.fn().mockResolvedValue(evaluateResult),
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
});
