import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runParallel } from '../src/runParallel.js';

vi.mock('fs');
vi.mock('puppeteer');
vi.mock('twd-js/runner-ci', () => ({ reportResults: vi.fn() }));
vi.mock('../src/contracts.js', () => ({ validateMocks: vi.fn() }));
vi.mock('../src/contractReport.js', () => ({ printContractReport: vi.fn() }));
vi.mock('../src/contractMarkdown.js', () => ({ generateContractMarkdown: vi.fn() }));

import fs from 'fs';
import puppeteer from 'puppeteer';
import { reportResults } from 'twd-js/runner-ci';

function createMockPage(evaluateResult, coverage = null) {
  const page = {
    goto: vi.fn(),
    waitForSelector: vi.fn(),
    exposeFunction: vi.fn(),
    evaluate: vi.fn(),
  };
  // page.evaluate is called twice per worker: once for runByIds, once for __coverage__.
  page.evaluate
    .mockResolvedValueOnce(evaluateResult)
    .mockResolvedValueOnce(coverage);
  return page;
}

function createMockContext(page) {
  return {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn(),
  };
}

function createMockBrowser(contexts) {
  let i = 0;
  return {
    createBrowserContext: vi.fn().mockImplementation(() => contexts[i++]),
    close: vi.fn(),
  };
}

const baseConfig = {
  url: 'http://localhost:5173',
  timeout: 10000,
  coverage: false,
  coverageDir: './coverage',
  nycOutputDir: './.nyc_output',
  headless: true,
  puppeteerArgs: [],
  retryCount: 2,
  parallel: true,
};

describe('runParallel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'time').mockImplementation(() => {});
    vi.spyOn(console, 'timeEnd').mockImplementation(() => {});
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockImplementation(() => {});
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(fs.rmSync).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('launches puppeteer once and creates 2 browser contexts', async () => {
    const page0 = createMockPage({ handlers: [], testStatus: [] });
    const page1 = createMockPage({ handlers: [], testStatus: [] });
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runParallel(baseConfig, '/cwd', []);

    expect(puppeteer.launch).toHaveBeenCalledTimes(1);
    expect(browser.createBrowserContext).toHaveBeenCalledTimes(2);
  });

  it('appends anti-throttle flags to user-supplied puppeteerArgs', async () => {
    const page0 = createMockPage({ handlers: [], testStatus: [] });
    const page1 = createMockPage({ handlers: [], testStatus: [] });
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runParallel({ ...baseConfig, puppeteerArgs: ['--user-flag'] }, '/cwd', []);

    const launchArgs = vi.mocked(puppeteer.launch).mock.calls[0][0].args;
    expect(launchArgs).toContain('--user-flag');
    expect(launchArgs).toContain('--disable-background-timer-throttling');
    expect(launchArgs).toContain('--disable-renderer-backgrounding');
    expect(launchArgs).toContain('--disable-backgrounding-occluded-windows');
  });

  it('does not duplicate an anti-throttle flag already provided by the user', async () => {
    const page0 = createMockPage({ handlers: [], testStatus: [] });
    const page1 = createMockPage({ handlers: [], testStatus: [] });
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runParallel(
      { ...baseConfig, puppeteerArgs: ['--disable-renderer-backgrounding'] },
      '/cwd',
      []
    );

    const launchArgs = vi.mocked(puppeteer.launch).mock.calls[0][0].args;
    const count = launchArgs.filter((a) => a === '--disable-renderer-backgrounding').length;
    expect(count).toBe(1);
  });

  it('navigates each page to config.url and waits for sidebar', async () => {
    const page0 = createMockPage({ handlers: [], testStatus: [] });
    const page1 = createMockPage({ handlers: [], testStatus: [] });
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runParallel(baseConfig, '/cwd', []);

    expect(page0.goto).toHaveBeenCalledWith('http://localhost:5173');
    expect(page1.goto).toHaveBeenCalledWith('http://localhost:5173');
    expect(page0.waitForSelector).toHaveBeenCalledWith(
      '#twd-sidebar-root',
      { timeout: 10000 }
    );
    expect(page1.waitForSelector).toHaveBeenCalledWith(
      '#twd-sidebar-root',
      { timeout: 10000 }
    );
  });

  it('passes workerIndex, N=2, and retryCount to each page.evaluate call', async () => {
    const page0 = createMockPage({ handlers: [], testStatus: [] });
    const page1 = createMockPage({ handlers: [], testStatus: [] });
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runParallel({ ...baseConfig, retryCount: 3 }, '/cwd', []);

    // First evaluate call per worker is the runByIds invocation.
    expect(page0.evaluate).toHaveBeenNthCalledWith(1, expect.any(Function), 0, 2, 3);
    expect(page1.evaluate).toHaveBeenNthCalledWith(1, expect.any(Function), 1, 2, 3);
  });

  it('sums pass/fail/skip counts across workers', async () => {
    const page0 = createMockPage({
      handlers: [{ id: 'a', name: 'a', type: 'test' }],
      testStatus: [{ id: 'a', status: 'pass' }],
    });
    const page1 = createMockPage({
      handlers: [{ id: 'b', name: 'b', type: 'test' }],
      testStatus: [{ id: 'b', status: 'fail', error: 'boom' }],
    });
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    const hasFailures = await runParallel(baseConfig, '/cwd', []);

    expect(hasFailures).toBe(true);
    expect(reportResults).toHaveBeenCalledTimes(2);
  });

  it('returns false when all workers pass', async () => {
    const page0 = createMockPage({
      handlers: [{ id: 'a', name: 'a', type: 'test' }],
      testStatus: [{ id: 'a', status: 'pass' }],
    });
    const page1 = createMockPage({
      handlers: [{ id: 'b', name: 'b', type: 'test' }],
      testStatus: [{ id: 'b', status: 'pass' }],
    });
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    const hasFailures = await runParallel(baseConfig, '/cwd', []);

    expect(hasFailures).toBe(false);
  });

  it('writes per-worker coverage files when config.coverage is true and __coverage__ is non-null', async () => {
    const page0 = createMockPage(
      { handlers: [], testStatus: [] },
      { file0: 'data' }
    );
    const page1 = createMockPage(
      { handlers: [], testStatus: [] },
      { file1: 'data' }
    );
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runParallel({ ...baseConfig, coverage: true }, '/cwd', []);

    const writes = vi.mocked(fs.writeFileSync).mock.calls.map((c) => c[0]);
    expect(writes.some((p) => p.endsWith('out-0.json'))).toBe(true);
    expect(writes.some((p) => p.endsWith('out-1.json'))).toBe(true);
  });

  it('does not write coverage files when config.coverage is false', async () => {
    const page0 = createMockPage({ handlers: [], testStatus: [] }, { file0: 'data' });
    const page1 = createMockPage({ handlers: [], testStatus: [] }, { file1: 'data' });
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runParallel({ ...baseConfig, coverage: false }, '/cwd', []);

    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('dumps coverage even when a worker has failures', async () => {
    const page0 = createMockPage(
      {
        handlers: [{ id: 'a', name: 'a', type: 'test' }],
        testStatus: [{ id: 'a', status: 'fail', error: 'boom' }],
      },
      { file0: 'data' }
    );
    const page1 = createMockPage(
      { handlers: [], testStatus: [] },
      { file1: 'data' }
    );
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runParallel({ ...baseConfig, coverage: true }, '/cwd', []);

    expect(fs.writeFileSync).toHaveBeenCalledTimes(2);
  });

  it('cleans .nyc_output before running when coverage is enabled', async () => {
    const page0 = createMockPage({ handlers: [], testStatus: [] }, { a: 1 });
    const page1 = createMockPage({ handlers: [], testStatus: [] }, { a: 1 });
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    await runParallel({ ...baseConfig, coverage: true }, '/cwd', []);

    expect(fs.rmSync).toHaveBeenCalledWith(
      expect.stringContaining('.nyc_output'),
      { recursive: true, force: true }
    );
  });

  it('exposes __twdCollectMock on each page when contracts are configured', async () => {
    const page0 = createMockPage({ handlers: [], testStatus: [] });
    const page1 = createMockPage({ handlers: [], testStatus: [] });
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    const { validateMocks } = await import('../src/contracts.js');
    const { printContractReport } = await import('../src/contractReport.js');
    vi.mocked(validateMocks).mockReturnValue({ results: [], skipped: [] });
    vi.mocked(printContractReport).mockReturnValue(false);

    await runParallel(
      { ...baseConfig, contracts: [{ source: './openapi.json' }] },
      '/cwd',
      [{ /* sentinel validator */ }]
    );

    expect(page0.exposeFunction).toHaveBeenCalledWith(
      '__twdCollectMock',
      expect.any(Function)
    );
    expect(page1.exposeFunction).toHaveBeenCalledWith(
      '__twdCollectMock',
      expect.any(Function)
    );
  });

  it('does not expose __twdCollectMock when contracts are not configured', async () => {
    const page0 = createMockPage({ handlers: [], testStatus: [] });
    const page1 = createMockPage({ handlers: [], testStatus: [] });
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    await runParallel(baseConfig, '/cwd', []);

    expect(page0.exposeFunction).not.toHaveBeenCalled();
    expect(page1.exposeFunction).not.toHaveBeenCalled();
  });

  it('feeds merged mocks (with workerIndex) into validateMocks', async () => {
    function makePage(workerHandlers, workerTestStatus, mockToCollect) {
      const page = {
        goto: vi.fn(),
        waitForSelector: vi.fn(),
        exposeFunction: vi.fn(),
        evaluate: vi.fn(),
      };
      page.evaluate
        .mockImplementationOnce(async () => {
          const exposed = page.exposeFunction.mock.calls.find(
            (c) => c[0] === '__twdCollectMock'
          );
          expect(exposed).toBeDefined();
          const collect = exposed[1];
          await collect(mockToCollect);
          return { handlers: workerHandlers, testStatus: workerTestStatus };
        })
        .mockResolvedValueOnce(null); // no coverage
      return page;
    }

    const page0 = makePage(
      [{ id: 't-0', name: 'describe0 > test0', type: 'test' }],
      [{ id: 't-0', status: 'pass' }],
      {
        alias: 'getA',
        method: 'GET',
        url: '/api/a',
        status: 200,
        response: 'x',
        testId: 't-0',
      }
    );
    const page1 = makePage(
      [{ id: 't-1', name: 'describe1 > test1', type: 'test' }],
      [{ id: 't-1', status: 'pass' }],
      {
        alias: 'getB',
        method: 'GET',
        url: '/api/b',
        status: 200,
        response: 'y',
        testId: 't-1',
      }
    );
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    const { validateMocks } = await import('../src/contracts.js');
    const { printContractReport } = await import('../src/contractReport.js');
    let capturedMocks;
    vi.mocked(validateMocks).mockImplementation((mocks) => {
      capturedMocks = mocks;
      return { results: [], skipped: [] };
    });
    vi.mocked(printContractReport).mockReturnValue(false);

    await runParallel(
      { ...baseConfig, contracts: [{ source: './openapi.json' }] },
      '/cwd',
      [{ /* sentinel */ }]
    );

    expect(capturedMocks).toBeDefined();
    const entries = Array.from(capturedMocks.values());
    expect(entries).toHaveLength(2);
    const aliases = entries.map((e) => e.alias).sort();
    expect(aliases).toEqual(['getA', 'getB']);
    const workerIndices = entries.map((e) => e.workerIndex).sort();
    expect(workerIndices).toEqual([0, 1]);
  });

  it('returns true when contract errors are printed', async () => {
    const page0 = createMockPage({ handlers: [], testStatus: [] });
    const page1 = createMockPage({ handlers: [], testStatus: [] });
    const browser = createMockBrowser([createMockContext(page0), createMockContext(page1)]);
    vi.mocked(puppeteer.launch).mockResolvedValue(browser);

    const { validateMocks } = await import('../src/contracts.js');
    const { printContractReport } = await import('../src/contractReport.js');
    vi.mocked(validateMocks).mockReturnValue({ results: [], skipped: [] });
    vi.mocked(printContractReport).mockReturnValue(true);

    const hasFailures = await runParallel(
      { ...baseConfig, contracts: [{ source: './openapi.json' }] },
      '/cwd',
      [{ /* sentinel */ }]
    );

    expect(hasFailures).toBe(true);
  });
});
