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
import { resolveRecordFilename } from './recordFilename.js';
import { selectShardIds } from './shard.js';
import { buildRunReport } from './runReport.js';
import { writeRunReport, DEFAULT_REPORT_DIR, COVERAGE_FILE } from './reportFiles.js';
import {
  assertFfmpegAvailable,
  applyRecordingFraming,
  startRecording,
  holdOpeningFrame,
  holdFinalFrame,
} from './recorder.js';

/**
 * Size in bytes of the recorded artifact, or null when it cannot be determined.
 *
 * A resolved `stop()` is not evidence of a usable file. Puppeteer's frame
 * pipeline buffers with `bufferCount(2, 1)`, so nothing is written until a
 * second CDP screencast frame arrives, and Chrome only emits frames on a
 * compositor update. A suite that never repaints, or a run with no tests at
 * all, finishes cleanly with a 0-byte file.
 *
 * The null case is unreachable against the real `fs`, where `statSync` either
 * returns a `Stats` or throws. It exists so an auto-mocked `fs` in the test
 * suite neither crashes here nor invents a bogus warning.
 */
function recordedFileSize(absPath) {
  try {
    const stats = fs.statSync(absPath);
    return stats && typeof stats.size === 'number' ? stats.size : null;
  } catch {
    // statSync throws ENOENT when the file was never created at all.
    return 0;
  }
}

export async function runTests(options = {}) {
  const { testFilters = [], recordOverrides = {}, shard = null, reportDir = null } = options;
  const sharded = Boolean(shard);
  let browser;
  let config;
  let startedAt = null;
  let partialStatus = [];
  let partialHandlers = [];
  let recorder = null;
  let recordOutput = null;
  let recordOutputPath = null;
  let recordingInfo = null;

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
    // config.record can be a shared default object; copy instead of mutating it.
    const record = { ...(config.record || {}), ...recordOverrides };
    const recording = Boolean(record.enabled);

    if (recording) {
      assertFfmpegAvailable(record.ffmpegPath);
    }

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

    if (recording) {
      await page.setViewport(record.viewport);
    }

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

    if (recording) {
      await applyRecordingFraming(page, record);
    }

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
    //
    // allTestIds is the full ordered list, before filtering or slicing. This is
    // what the fingerprint hashes and what discovery.totalTests reports, so
    // every shard agrees on it regardless of which slice it took.
    const allTestIds = orderedTestIds(registeredHandlers);
    const filteredIds = selectedIds ?? allTestIds;
    const baseIds = sharded
      ? selectShardIds(filteredIds, shard.index, shard.total)
      : filteredIds;

    if (sharded) {
      console.log(
        `Shard ${shard.index}/${shard.total}: running ${baseIds.length} of ${filteredIds.length} test(s).`
      );
    }

    const chunks = chunk(baseIds, config.chunkSize);

    // Recording starts here, not earlier: the output path is fixed up front by
    // page.screencast(), and the filename depends on which tests survived the
    // filter. Starting after baseIds is resolved also means the "no tests
    // matched" early return can never leave a recorder running.
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
      recordOutputPath = path.resolve(workingDir, recordOutput);
      recorder = await startRecording(page, record, recordOutputPath);

      if (record.pace) {
        // twd-js spaces out its own command loop, so frames are captured at
        // full rate rather than the video being stretched afterwards.
        // Returns null when the installed twd-js predates the pacing hook, so
        // an older version degrades to an unpaced recording instead of
        // crashing the run with a bare TypeError.
        const applied = await page.evaluate((ms) => {
          if (typeof window.__twdSetPace !== 'function') return null;
          return window.__twdSetPace(ms);
        }, record.pace);

        if (applied === null) {
          console.warn(
            'Warning: --record-pace needs twd-js 1.9.0 or newer (no pacing hook found). Recording unpaced.'
          );
        } else if (applied !== record.pace) {
          // twd-js clamps, so report what actually took effect.
          console.warn(`Warning: pace clamped to ${applied}ms (requested ${record.pace}ms).`);
        }
      }

      await holdOpeningFrame(record.preRoll);
    }

    // Handlers for path-building/summary come from the enumeration so partial
    // results are always printable even if a chunk never returns.
    const handlers = registeredHandlers;
    partialStatus = [];
    let executed = 0;
    let stoppedEarly = false;
    const seenIds = new Set();

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

      for (const entry of chunkStatus) {
        if (seenIds.has(entry.id)) continue;
        seenIds.add(entry.id);
        partialStatus.push(entry);
      }
      executed += ids.length;

      if (config.maxFailures > 0) {
        const failed = partialStatus.filter((t) => t.status === 'fail').length;
        if (failed >= config.maxFailures) {
          stoppedEarly = true;
          break;
        }
      }
    }

    // Must run before stopRecorder(): it is what gets the last test's result
    // into the video at all, not just a pause on the end. See holdFinalFrame.
    if (recording) {
      await holdFinalFrame(page, record.postRoll);
    }

    await stopRecorder();
    if (recording) {
      // Report what is on disk, not that stop() resolved. This also covers a
      // stop() that rejected, which stopRecorder swallows into a warning.
      if (recordedFileSize(recordOutputPath) === 0) {
        console.warn(
          `Warning: recording produced an empty file at ${recordOutput}.`
        );
        console.warn(
          'Chrome only emits video frames when the page repaints, so a run with no visible changes (or no tests) records nothing.'
        );
      } else {
        recordingInfo = { file: recordOutput, bytes: recordedFileSize(recordOutputPath) };
        console.log(`Recorded ${executed} test(s) to ${recordOutput}`);
      }
    }

    const testStatus = partialStatus;
    const endedAt = Date.now();
    const durationMs = endedAt - startedAt;
    const notRun = baseIds.length - executed;

    // Exit with appropriate code
    let hasFailures = stoppedEarly || testStatus.some((test) => test.status === 'fail');

    // Enrich collected mocks with full test path names
    for (const [, mock] of collectedMocks) {
      if (mock.testId) {
        mock.testName = buildTestPath(mock.testId, handlers);
      }
    }

    // Contract validation. A sharded run validates even after an early stop and
    // flags the result partial, so merge can say exactly what is missing rather
    // than silently dropping a shard's worth of mocks. A non-sharded run keeps
    // skipping, exactly as before.
    const contractsConfigured = Boolean(config.contracts && config.contracts.length > 0);
    let contractsBlock = {
      configured: contractsConfigured,
      partial: false,
      results: [],
      skipped: [],
    };

    if (contractsConfigured && (sharded || !stoppedEarly)) {
      if (collectedMocks.size === 0) {
        console.log('\nNo mocks collected — ensure twd-js supports contract collection');
      }
      const validationOutput = validateMocks(collectedMocks, contractValidators);
      const hasContractErrors = printContractReport(validationOutput);
      if (hasContractErrors) {
        hasFailures = true;
      }

      contractsBlock = {
        configured: true,
        partial: stoppedEarly,
        results: validationOutput.results,
        skipped: validationOutput.skipped,
      };

      if (stoppedEarly) {
        console.log('\n⚠ Contract data is partial — this shard stopped early.');
      }

      // Write markdown report for CI/PR integration.
      //
      // Only a whole run produces a meaningful markdown report. Under sharding
      // each shard would overwrite the others with a quarter of the picture, so
      // `merge` writes it instead.
      if (config.contractReportPath && !sharded) {
        const reportPath = path.resolve(workingDir, config.contractReportPath);
        const reportDirPath = path.dirname(reportPath);
        if (!fs.existsSync(reportDirPath)) {
          fs.mkdirSync(reportDirPath, { recursive: true });
        }
        const markdown = generateContractMarkdown(validationOutput);
        fs.writeFileSync(reportPath, markdown);
        console.log(`Contract report written to ${config.contractReportPath}`);
      }
    } else if (contractsConfigured && stoppedEarly) {
      console.log('\nSkipping contract validation — run stopped early (partial data).');
    }

    // Handle code coverage if enabled.
    //
    // The filter gate is unchanged: a --test filter still suppresses coverage,
    // because a filtered run's number is a misleading project-wide figure. A
    // shard slice is not a filter.
    //
    // The failure gate is relaxed for sharded runs only. hasFailures is per
    // shard, so applying it here would let three green shards write coverage
    // while a red fourth writes none — a merged report that looks complete but
    // is missing a quarter of the code paths. `merge` applies the gate to the
    // true global result instead.
    if (selectedIds && config.coverage) {
      console.log('Skipping coverage collection (test filter active).');
    }

    let coverageData = null;
    if (config.coverage && !selectedIds && (sharded || !hasFailures)) {
      coverageData = await page.evaluate(() => window.__coverage__);
      if (!coverageData) {
        console.log('No code coverage data found.');
      }
    }

    // A sharded run's coverage goes to the report dir and nowhere else. Writing
    // it to .nyc_output/out.json — the path nyc reads by default — would let one
    // shard's partial data masquerade as the whole run's.
    if (coverageData && !sharded) {
      const coverageDir = path.resolve(workingDir, config.coverageDir);
      const nycDir = path.resolve(workingDir, config.nycOutputDir);

      if (!fs.existsSync(nycDir)) {
        fs.mkdirSync(nycDir, { recursive: true });
      }
      if (!fs.existsSync(coverageDir)) {
        fs.mkdirSync(coverageDir, { recursive: true });
      }

      const coveragePath = path.join(nycDir, 'out.json');
      fs.writeFileSync(coveragePath, JSON.stringify(coverageData));
      console.log(`Code coverage data written to ${coveragePath}`);
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

    // Written last, and only for a sharded run. A run that threw never gets
    // here on purpose: its artifact stays absent, and `merge` reports the gap as
    // "a shard job likely failed before uploading", which is the accurate
    // diagnosis. A half-written report would be a worse lie.
    if (sharded) {
      const dir = reportDir ?? DEFAULT_REPORT_DIR;
      const report = buildRunReport({
        shard,
        startedAt,
        endedAt,
        allTestIds,
        filters: testFilters,
        handlers,
        tests: testStatus,
        executed,
        notRun,
        stoppedEarly,
        coverageFile: coverageData ? COVERAGE_FILE : null,
        recording: recordingInfo,
        contracts: contractsBlock,
      });
      const { reportPath } = writeRunReport(dir, report, coverageData);
      console.log(`Shard report written to ${reportPath}`);
    }

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
    await stopRecorder();
    if (browser) await browser.close();
    throw error;
  }
}
