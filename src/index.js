import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import { reportResults } from 'twd-js/runner-ci';
import { loadConfig } from './config.js';
import { loadContracts, validateMocks } from './contracts.js';
import { printContractReport } from './contractReport.js';

export async function runTests() {
  let browser;
  try {
    const config = loadConfig();
    const workingDir = process.cwd();

    console.log('Starting TWD test runner...');
    console.log('Configuration:', JSON.stringify(config, null, 2));

    // Load contract validators if configured
    let contractValidators = [];
    if (config.contracts && config.contracts.length > 0) {
      contractValidators = await loadContracts(config.contracts, workingDir);
    }

    browser = await puppeteer.launch({
      headless: config.headless,
      args: config.puppeteerArgs,
    });

    const page = await browser.newPage();
    console.time('Total Test Time');

    // Register mock collector for contract validation
    const collectedMocks = new Map();
    if (config.contracts && config.contracts.length > 0) {
      await page.exposeFunction('__twdCollectMock', (mock) => {
        const key = `${mock.method}:${mock.url}:${mock.status}`;
        if (!collectedMocks.has(key)) {
          collectedMocks.set(key, mock);
        }
      });
    }

    // Navigate to your development server
    console.log(`Navigating to ${config.url} ...`);
    await page.goto(config.url);

    // Wait for the selector to be available
    await page.waitForSelector('#twd-sidebar-root', { timeout: config.timeout });
    console.log('Page loaded. Starting tests...');

    // Execute all tests
    const { handlers, testStatus } = await page.evaluate(async (retryCount) => {
      const TestRunner = window.__testRunner;
      const testStatus = [];
      const runner = new TestRunner({
        onStart: () => {},
        onPass: (test, retryAttempt) => {
          const entry = { id: test.id, status: "pass" };
          if (retryAttempt !== undefined) entry.retryAttempt = retryAttempt;
          testStatus.push(entry);
        },
        onFail: (test, err) => {
          testStatus.push({ id: test.id, status: "fail", error: `${err.message} (at ${window.location.href})` });
        },
        onSkip: (test) => {
          testStatus.push({ id: test.id, status: "skip" });
        },
      }, { retryCount });
      const handlers = await runner.runAll();
      return { handlers: Array.from(handlers.values()), testStatus };
    }, config.retryCount);

    console.log(`Tests to report: ${testStatus.length}`);

    // Display results in console
    reportResults(handlers, testStatus);

    // Display retry summary if any tests were retried
    const retriedTests = testStatus.filter(t => t.retryAttempt >= 2);
    if (retriedTests.length > 0) {
      console.log('\n⟳ Retried tests:');
      for (const t of retriedTests) {
        const handler = handlers.find(h => h.id === t.id);
        const name = handler ? handler.name : t.id;
        console.log(`  ✓ ${name} (passed on attempt ${t.retryAttempt})`);
      }
      console.log(`  ${retriedTests.length} test(s) required retries to pass.`);
    }

    // Exit with appropriate code
    let hasFailures = testStatus.some(test => test.status === 'fail');
    console.timeEnd('Total Test Time');

    // Contract validation
    if (config.contracts && config.contracts.length > 0) {
      if (collectedMocks.size === 0) {
        console.log('\nNo mocks collected — ensure twd-js supports contract collection');
      }
      const validationOutput = validateMocks(collectedMocks, contractValidators);
      const hasContractErrors = printContractReport(validationOutput);
      if (hasContractErrors) {
        hasFailures = true;
      }
    }

    // Handle code coverage if enabled
    if (config.coverage && !hasFailures) {
      const coverage = await page.evaluate(() => window.__coverage__);
      if (coverage) {
        console.log('Collecting code coverage data...');
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
    console.log('Browser closed.');

    return hasFailures;

  } catch (error) {
    console.error('Error running tests:', error);
    if (browser) await browser.close();
    throw error;
  }
}
