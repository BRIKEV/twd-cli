import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import { loadConfig } from './config.js';
import { loadContracts, validateMocks } from './contracts.js';
import { printContractReport } from './contractReport.js';
import { generateContractMarkdown } from './contractMarkdown.js';
import { buildTestPath } from './buildTestPath.js';
import { formatRunComplete } from './testSummary.js';
import { selectTestIds } from './filterTests.js';
import { explainError } from './diagnostics.js';
import { orderedTestIds, chunk } from './testOrder.js';

export async function runTests(options = {}) {
  const { testFilters = [] } = options;
  let browser;
  let config;
  let startedAt = null;
  let partialStatus = [];
  let partialHandlers = [];
  try {
    config = loadConfig();
    const workingDir = process.cwd();

    // Load contract validators if configured
    let contractValidators = [];
    if (config.contracts && config.contracts.length > 0) {
      contractValidators = await loadContracts(config.contracts, workingDir);
    }

    browser = await puppeteer.launch({
      headless: config.headless,
      args: config.puppeteerArgs,
      protocolTimeout: config.protocolTimeout,
    });

    const page = await browser.newPage();

    // Register mock collector for contract validation
    const collectedMocks = new Map();
    const occurrenceCounters = new Map();
    if (config.contracts && config.contracts.length > 0) {
      await page.exposeFunction('__twdCollectMock', (mock) => {
        const occKey = `${mock.alias}:${mock.testId}`;
        const count = (occurrenceCounters.get(occKey) || 0) + 1;
        occurrenceCounters.set(occKey, count);

        const dedupKey = `${mock.method}:${mock.url}:${mock.status}:${mock.testId}:${count}`;
        collectedMocks.set(dedupKey, { ...mock, occurrence: count });
      });
    }

    // Navigate to your development server
    startedAt = Date.now();
    console.log(`Navigating to ${config.url} ...`);
    await page.goto(config.url);

    // Wait for the selector to be available
    await page.waitForSelector('#twd-sidebar-root', { timeout: config.timeout });

    // Enumerate registered handlers (for the count line and --test filtering)
    const registeredHandlers = await page.evaluate(() => {
      const state = window.__TWD_STATE__;
      if (!state || !state.handlers) return [];
      return Array.from(state.handlers.values()).map((h) => ({
        id: h.id,
        name: h.name,
        parent: h.parent,
        type: h.type,
      }));
    });
    partialHandlers = registeredHandlers;

    // Resolve --test filters to a concrete set of test ids (null = run all)
    let selectedIds = null;
    if (testFilters.length > 0) {
      const { ids, unmatchedFilters } = selectTestIds(registeredHandlers, testFilters);

      if (ids.length === 0) {
        console.error(
          `No tests matched filter(s): ${testFilters.map((f) => `"${f}"`).join(', ')}`
        );
        await browser.close();
        return true;
      }

      if (unmatchedFilters.length > 0) {
        console.warn(
          `Warning: these filter(s) matched no tests (others did): ${unmatchedFilters.map((f) => `"${f}"`).join(', ')}`
        );
      }

      selectedIds = ids;
      console.log(`Filtering: running ${ids.length} test(s) matching --test filter(s).`);
    } else {
      const testCount = registeredHandlers.filter((h) => h.type === 'test').length;
      console.log(`Running ${testCount} test(s)...`);
    }

    // Resolve the ordered id list to run: the filter result, or all tests.
    const baseIds = selectedIds ?? orderedTestIds(registeredHandlers);
    const chunks = chunk(baseIds, config.chunkSize);

    // Handlers for path-building/summary come from the enumeration so partial
    // results are always printable even if a chunk never returns.
    const handlers = registeredHandlers;
    partialStatus = [];
    let executed = 0;
    let stoppedEarly = false;

    for (const ids of chunks) {
      const chunkStatus = await page.evaluate(async (retryCount, chunkIds) => {
        const TestRunner = window.__testRunner;
        const testStatus = [];
        const runner = new TestRunner({
          onStart: (test) => {
            test.status = "running";
          },
          onPass: (test, retryAttempt) => {
            test.status = "done";
            const entry = { id: test.id, status: "pass" };
            if (retryAttempt !== undefined) entry.retryAttempt = retryAttempt;
            testStatus.push(entry);
          },
          onFail: (test, err) => {
            test.status = "done";
            testStatus.push({ id: test.id, status: "fail", error: `${err.message} (at ${window.location.href})` });
          },
          onSkip: (test) => {
            test.status = "done";
            testStatus.push({ id: test.id, status: "skip" });
          },
        }, { retryCount });
        await runner.runByIds(chunkIds);
        return testStatus;
      }, config.retryCount, ids);

      partialStatus.push(...chunkStatus);
      executed += ids.length;

      if (config.maxFailures > 0) {
        const failed = partialStatus.filter((t) => t.status === 'fail').length;
        if (failed >= config.maxFailures) {
          stoppedEarly = true;
          break;
        }
      }
    }

    const testStatus = partialStatus;
    const durationMs = Date.now() - startedAt;
    const notRun = baseIds.length - executed;

    // Exit with appropriate code
    let hasFailures = stoppedEarly || testStatus.some((test) => test.status === 'fail');

    // Enrich collected mocks with full test path names
    for (const [, mock] of collectedMocks) {
      if (mock.testId) {
        mock.testName = buildTestPath(mock.testId, handlers);
      }
    }

    // Contract validation (skipped on an early stop — the data is partial)
    if (!stoppedEarly && config.contracts && config.contracts.length > 0) {
      if (collectedMocks.size === 0) {
        console.log('\nNo mocks collected — ensure twd-js supports contract collection');
      }
      const validationOutput = validateMocks(collectedMocks, contractValidators);
      const hasContractErrors = printContractReport(validationOutput);
      if (hasContractErrors) {
        hasFailures = true;
      }

      // Write markdown report for CI/PR integration
      if (config.contractReportPath) {
        const reportPath = path.resolve(workingDir, config.contractReportPath);
        const reportDir = path.dirname(reportPath);
        if (!fs.existsSync(reportDir)) {
          fs.mkdirSync(reportDir, { recursive: true });
        }
        const markdown = generateContractMarkdown(validationOutput);
        fs.writeFileSync(reportPath, markdown);
        console.log(`Contract report written to ${config.contractReportPath}`);
      }
    } else if (stoppedEarly && config.contracts && config.contracts.length > 0) {
      console.log('\nSkipping contract validation — run stopped early (partial data).');
    }

    // Handle code coverage if enabled (skipped when a --test filter is active)
    if (selectedIds && config.coverage) {
      console.log('Skipping coverage collection (test filter active).');
    }
    if (config.coverage && !hasFailures && !selectedIds) {
      const coverage = await page.evaluate(() => window.__coverage__);
      if (coverage) {
        const coverageDir = path.resolve(workingDir, config.coverageDir);
        const nycDir = path.resolve(workingDir, config.nycOutputDir);

        if (!fs.existsSync(nycDir)) {
          fs.mkdirSync(nycDir, { recursive: true });
        }
        if (!fs.existsSync(coverageDir)) {
          fs.mkdirSync(coverageDir, { recursive: true });
        }

        const coveragePath = path.join(nycDir, 'out.json');
        fs.writeFileSync(coveragePath, JSON.stringify(coverage));
        console.log(`Code coverage data written to ${coveragePath}`);
      } else {
        console.log('No code coverage data found.');
      }
    }

    await browser.close();

    // The run-complete block is always the last output of a completed run
    console.log('');
    console.log(formatRunComplete({
      testStatus,
      handlers,
      durationMs,
      notRun,
      stoppedEarly,
      maxFailures: config.maxFailures,
    }));

    return hasFailures;

  } catch (error) {
    if (partialStatus.length > 0) {
      const durationMs = startedAt ? Date.now() - startedAt : 0;
      console.log('');
      console.log(formatRunComplete({
        testStatus: partialStatus,
        handlers: partialHandlers,
        durationMs,
      }));
      console.log('\nRun interrupted before completion — results above are partial.');
    }
    const message = error && error.message ? error.message : String(error);
    console.error(`Error running tests: ${message}`);
    const diagnostic = explainError(error, config);
    if (diagnostic) {
      console.error(`\n${diagnostic}`);
    } else if (error && error.stack) {
      console.error(`\n${error.stack}`);
    }
    if (error && typeof error === 'object') {
      error.reported = true;
    }
    if (browser) await browser.close();
    throw error;
  }
}
