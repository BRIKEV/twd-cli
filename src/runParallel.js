import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import { reportResults } from 'twd-js/runner-ci';
import { validateMocks } from './contracts.js';
import { printContractReport } from './contractReport.js';
import { generateContractMarkdown } from './contractMarkdown.js';
import { buildTestPath } from './buildTestPath.js';
import { mergeMocks } from './mergeMocks.js';

const WORKERS = 2;

const ANTI_THROTTLE_FLAGS = [
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
];

function mergeArgs(userArgs, extras) {
  const merged = [...userArgs];
  for (const flag of extras) {
    if (!merged.includes(flag)) merged.push(flag);
  }
  return merged;
}

function makeMockCollector(workerMocks, workerCounters) {
  return (mock) => {
    const occKey = `${mock.alias}:${mock.testId}`;
    const count = (workerCounters.get(occKey) || 0) + 1;
    workerCounters.set(occKey, count);
    const dedupKey = `${mock.method}:${mock.url}:${mock.status}:${mock.testId}:${count}`;
    workerMocks.set(dedupKey, { ...mock, occurrence: count });
  };
}

async function runWorker(browser, workerIndex, config, workingDir, contractsConfigured, workerMocks, workerCounters) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();

  if (contractsConfigured) {
    await page.exposeFunction(
      '__twdCollectMock',
      makeMockCollector(workerMocks, workerCounters)
    );
  }

  await page.goto(config.url);
  await page.waitForSelector('#twd-sidebar-root', { timeout: config.timeout });

  const { handlers, testStatus } = await page.evaluate(
    async (workerIndex, N, retryCount) => {
      const allIds = Array.from(window.__TWD_STATE__.handlers.values())
        .filter((h) => h.type === 'test')
        .map((h) => h.id);
      const myIds = allIds.filter((_, idx) => idx % N === workerIndex);

      const TestRunner = window.__testRunner;
      const testStatus = [];
      const runner = new TestRunner(
        {
          onStart: (test) => { test.status = 'running'; },
          onPass: (test, retryAttempt) => {
            test.status = 'done';
            const entry = { id: test.id, status: 'pass' };
            if (retryAttempt !== undefined) entry.retryAttempt = retryAttempt;
            testStatus.push(entry);
          },
          onFail: (test, err) => {
            test.status = 'done';
            testStatus.push({
              id: test.id,
              status: 'fail',
              error: `${err.message} (at ${window.location.href})`,
            });
          },
          onSkip: (test) => {
            test.status = 'done';
            testStatus.push({ id: test.id, status: 'skip' });
          },
        },
        { retryCount }
      );
      const handlers = await runner.runByIds(myIds);
      return { handlers: Array.from(handlers.values()), testStatus };
    },
    workerIndex,
    WORKERS,
    config.retryCount
  );

  if (config.coverage) {
    const coverage = await page.evaluate(() => window.__coverage__);
    if (coverage) {
      const nycDir = path.resolve(workingDir, config.nycOutputDir);
      const outPath = path.join(nycDir, `out-${workerIndex}.json`);
      fs.writeFileSync(outPath, JSON.stringify(coverage));
      console.log(`Worker ${workerIndex}: coverage → ${outPath}`);
    } else {
      console.log(`Worker ${workerIndex}: no __coverage__ on window`);
    }
  }

  await ctx.close();
  return { workerIndex, handlers, testStatus };
}

export async function runParallel(config, workingDir, contractValidators) {
  let browser;
  try {
    console.log(`Starting TWD test runner (parallel mode, ${WORKERS} workers)...`);
    console.log('Configuration:', JSON.stringify(config, null, 2));

    const contractsConfigured = config.contracts && config.contracts.length > 0;
    const workerMocks = Array.from({ length: WORKERS }, () => new Map());
    const workerCounters = Array.from({ length: WORKERS }, () => new Map());

    if (config.coverage) {
      const nycDir = path.resolve(workingDir, config.nycOutputDir);
      if (fs.existsSync(nycDir)) {
        fs.rmSync(nycDir, { recursive: true, force: true });
      }
      fs.mkdirSync(nycDir, { recursive: true });
    }

    browser = await puppeteer.launch({
      headless: config.headless,
      args: mergeArgs(config.puppeteerArgs, ANTI_THROTTLE_FLAGS),
    });

    console.time('Parallel test time');
    const workerResults = await Promise.all(
      Array.from({ length: WORKERS }, (_, i) =>
        runWorker(
          browser,
          i,
          config,
          workingDir,
          contractsConfigured,
          workerMocks[i],
          workerCounters[i]
        )
      )
    );
    console.timeEnd('Parallel test time');

    let totalPass = 0;
    let totalFail = 0;
    let totalSkip = 0;
    for (const { workerIndex, handlers, testStatus } of workerResults) {
      console.log(`\n────── Worker ${workerIndex} results ──────`);
      reportResults(handlers, testStatus);
      const pass = testStatus.filter((s) => s.status === 'pass').length;
      const fail = testStatus.filter((s) => s.status === 'fail').length;
      const skip = testStatus.filter((s) => s.status === 'skip').length;
      console.log(
        `Worker ${workerIndex}: ${pass} passed, ${fail} failed, ${skip} skipped`
      );
      totalPass += pass;
      totalFail += fail;
      totalSkip += skip;
    }

    console.log(`\n────── Summary ──────`);
    console.log(
      `Total: ${totalPass} passed, ${totalFail} failed, ${totalSkip} skipped`
    );

    let hasFailures = totalFail > 0;

    if (contractsConfigured) {
      const merged = mergeMocks(workerMocks);

      for (const [, mock] of merged) {
        if (mock.testId) {
          const workerHandlers = workerResults[mock.workerIndex].handlers;
          mock.testName = buildTestPath(mock.testId, workerHandlers);
        }
      }

      if (merged.size === 0) {
        console.log('\nNo mocks collected — ensure twd-js supports contract collection');
      }
      const validationOutput = validateMocks(merged, contractValidators);
      const hasContractErrors = printContractReport(validationOutput);
      if (hasContractErrors) hasFailures = true;

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
    }

    await browser.close();
    console.log('Browser closed.');
    return hasFailures;
  } catch (error) {
    console.error('Error running tests (parallel):', error);
    if (browser) await browser.close();
    throw error;
  }
}
