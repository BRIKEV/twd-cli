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
import { resolveChangedTitles } from './changedTests.js';
import { explainError } from './diagnostics.js';
import { orderedTestIds, chunk } from './testOrder.js';
import { resolveRecordFilename } from './recordFilename.js';
import { selectShardIds } from './shard.js';
import { buildRunReport } from './runReport.js';
import { writeRunReport, DEFAULT_REPORT_DIR, COVERAGE_FILE } from './reportFiles.js';
import { writeSnapshotReport, clearFailureCaptures } from './snapshotReport.js';
import {
  assertFfmpegCapable,
  createFfmpegLog,
  applyRecordingFraming,
  startRecording,
  watchRecorder,
  stopRecording,
  transcodeForPlayback,
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
  const {
    testFilters = [],
    changedSince = null,
    recordOverrides = {},
    shard = null,
    reportDir = null,
    updateSnapshots = false,
    ci = false,
  } = options;
  const sharded = Boolean(shard);
  let browser;
  let config;
  let startedAt = null;
  let partialStatus = [];
  let partialHandlers = [];
  let recorder = null;
  let recorderHealth = null;
  let stopOutcome = null;
  let ffmpegLog = null;
  let recordOutput = null;
  let recordOutputPath = null;
  let recordingInfo = null;

  // Stops the screencast at most once. Must always run before browser.close():
  // if the browser goes first, ffmpeg is orphaned and the file is truncated.
  //
  // Silent by design — the outcome is reported once, by the caller that knows
  // whether the run is otherwise healthy, rather than twice from two paths.
  const stopRecorder = async () => {
    if (!recorder) return;
    const active = recorder;
    const health = recorderHealth;
    recorder = null;
    recorderHealth = null;
    stopOutcome = await stopRecording(active, health ?? {});
  };

  // The only place ffmpeg's own words ever surface. Puppeteer hands its stderr
  // to the debug logger and to nothing else, so before this the sole way to
  // answer "why did the encode fail" was to point record.ffmpegPath at a
  // wrapper script that tees it.
  const reportRecordingFailure = (reason) => {
    console.error(`\nRecording failed: ${reason}.`);
    const lines = ffmpegLog ? ffmpegLog.lines : [];
    if (lines.length > 0) {
      console.error('ffmpeg reported:');
      for (const line of lines) console.error(`  ${line}`);
    } else {
      console.error('ffmpeg wrote nothing before exiting. Re-run with NODE_DEBUG=puppeteer:ffmpeg for its full output.');
    }
  };

  try {
    config = loadConfig();
    const workingDir = process.cwd();

    // Resolved before anything else, including the ffmpeg probe: a branch that
    // changed no tests then needs neither a browser, nor a dev server, nor
    // ffmpeg. That is the step this deletes from every caller's workflow, which
    // otherwise counts the titles itself and skips the job.
    let changedTitles = null;
    if (changedSince) {
      changedTitles = resolveChangedTitles(changedSince, workingDir).titles;
      if (changedTitles.length === 0) {
        // A query with an empty result is not a failure, unlike a --test filter
        // that matched nothing.
        console.log(`No tests changed since ${changedSince} — nothing to run.`);
        return false;
      }
      console.log(
        `Changed since ${changedSince}: ${changedTitles.length} test title(s) to match.`
      );
    }
    // config.record can be a shared default object; copy instead of mutating it.
    const record = { ...(config.record || {}), ...recordOverrides };
    const recording = Boolean(record.enabled);

    if (recording) {
      assertFfmpegCapable(record.ffmpegPath, record.format);
      ffmpegLog = createFfmpegLog();
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
      // Only while recording, and it delegates every other channel, so a run
      // that is not recording keeps puppeteer's own debug logger untouched.
      ...(ffmpegLog ? { logger: ffmpegLog.logger } : {}),
    });

    const page = await browser.newPage();

    // Every run gets an explicit viewport, not just a recorded one. Layout
    // snapshots are only reproducible if the size is fixed and stated: relying
    // on puppeteer's implicit default would mean an upgrade could change it and
    // invalidate every committed reference at once, without a word.
    // record.viewport still wins while recording, since it sets the video size.
    await page.setViewport(recording ? record.viewport : config.viewport);

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

    // evaluateOnNewDocument, never evaluate: this runs before any script on the
    // page, so the flags are already set by the time matchLayout reads them.
    // The twdSnapshot vite plugin sets its own flag with ??= precisely so this
    // injection wins. __TWD_SNAPSHOTS__ is always on here because twd-cli is
    // where a layout snapshot is actually decided.
    await page.evaluateOnNewDocument((flags) => {
      window.__TWD_SNAPSHOTS__ = true;
      if (flags.update) window.__TWD_UPDATE_SNAPSHOTS__ = true;
      if (flags.ci) window.__TWD_SNAPSHOT_CI__ = true;
    }, { update: updateSnapshots, ci });

    // Drop captures from earlier runs before this one can add its own, so the
    // report cannot show a failure that has since been fixed.
    clearFailureCaptures(path.resolve(workingDir, config.snapshotDir));

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

    // Resolve filters to a concrete set of test ids (null = run all). Typed
    // --test filters and computed --changed-since titles are one set: filters
    // already OR together, so there is no precedence rule to remember and
    // --test stays usable to add one extra test to a branch's own.
    const activeFilters = changedTitles ? [...testFilters, ...changedTitles] : testFilters;
    let selectedIds = null;
    if (activeFilters.length > 0) {
      const { ids, unmatchedFilters } = selectTestIds(registeredHandlers, activeFilters);

      if (ids.length === 0) {
        if (changedTitles) {
          console.log(
            `No registered test matched the ${changedTitles.length} title(s) changed since ${changedSince}.`
          );
          await browser.close();
          return false;
        }
        console.error(
          `No tests matched filter(s): ${testFilters.map((f) => `"${f}"`).join(', ')}`
        );
        await browser.close();
        return true;
      }

      // Only filters the user actually typed. A computed title that matches no
      // registered test is normal — the file it lives in may not be loaded —
      // and warning about it would be unactionable noise on every run.
      const unmatchedTyped = unmatchedFilters.filter((f) => testFilters.includes(f));
      if (unmatchedTyped.length > 0) {
        console.warn(
          `Warning: these filter(s) matched no tests (others did): ${unmatchedTyped.map((f) => `"${f}"`).join(', ')}`
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
    // allTestIds is the full ordered list, before filtering or slicing. Its
    // order is what the fingerprint covers (as paths — the ids themselves are
    // random per page load) and its length is discovery.totalTests, so every
    // shard agrees on both regardless of which slice it took. filteredIds is
    // the list the shards divide, so it is what executed + notRun must total.
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
      // Attached immediately: an encoder that rejects puppeteer's arguments dies
      // within a second of the first frame, long before the run is over.
      recorderHealth = watchRecorder(recorder);

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
            // The raw snapshot travels out; src/failureDiagnostics.js renders
            // it in Node. This callback is serialised into the page and has no
            // module scope, so it cannot reach a formatter, and duplicating one
            // here would be a copy that drifts. `undefined` on a twd-js without
            // diagnostics support, and dropped by serialisation.
            testStatus.push({
              id: test.id,
              status: "fail",
              diagnostics: test.diagnostics,
              error: `${err.message} (at ${window.location.href})`,
            });
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
    let recordingFailed = false;
    if (recording) {
      if (stopOutcome && !stopOutcome.ok) {
        // A broken recording is a failed run even when every test passed: the
        // artifact was the point of asking for one, and a silent pass would send
        // the next person looking for a video that is not there.
        recordingFailed = true;
        reportRecordingFailure(stopOutcome.reason);
        console.error(`The file at ${recordOutput} is incomplete.`);
      } else if (recordedFileSize(recordOutputPath) === 0) {
        // Report what is on disk, not that stop() resolved.
        console.warn(
          `Warning: recording produced an empty file at ${recordOutput}.`
        );
        console.warn(
          'Chrome only emits video frames when the page repaints, so a run with no visible changes (or no tests) records nothing.'
        );
      } else {
        // Only mp4 needs this. webm carrying VP9 is exactly what a .webm is for,
        // and a gif is already universally playable.
        if (record.format === 'mp4') {
          const converted = transcodeForPlayback(record.ffmpegPath, recordOutputPath);
          if (!converted.ok) {
            console.warn(`Warning: could not convert the recording to H.264: ${converted.reason}`);
            console.warn(
              'The file is VP9 in an mp4 container, which plays in Chrome or VLC but not in QuickTime or Preview.'
            );
          }
        }
        // Measured after the conversion, which replaces the file and shrinks it
        // by roughly four times.
        recordingInfo = { file: recordOutput, bytes: recordedFileSize(recordOutputPath) };
        console.log(`Recorded ${executed} test(s) to ${recordOutput}`);
      }
    }

    const testStatus = partialStatus;
    const endedAt = Date.now();
    const durationMs = endedAt - startedAt;
    const notRun = baseIds.length - executed;

    // Exit with appropriate code
    let hasFailures = recordingFailed || stoppedEarly || testStatus.some((test) => test.status === 'fail');

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
      // Never under sharding. A shard whose slice exercised no mocks — and any
      // shard with an empty slice — collects nothing, which is normal, so this
      // would advertise a twd-js version problem that does not exist on the
      // happy path of every sharded CI run.
      if (collectedMocks.size === 0 && !sharded) {
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

    const snapshotReport = writeSnapshotReport(
      path.resolve(workingDir, config.snapshotDir),
      '.twd'
    );
    if (snapshotReport) {
      const skipped = snapshotReport.skipped.length
        ? `, ${snapshotReport.skipped.length} could not be read`
        : '';
      console.log(
        `Layout snapshot failures: ${snapshotReport.count} captured${skipped}. ` +
          `Open ${snapshotReport.reportPath}`
      );
    }

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
        filteredIds,
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
    // Stated as a fact, not as the cause: a dead encoder can disrupt the run
    // that follows it, and reporting only the downstream error would leave the
    // first thing that broke unmentioned.
    if (stopOutcome && !stopOutcome.ok) {
      reportRecordingFailure(stopOutcome.reason);
    }
    if (browser) await browser.close();
    throw error;
  }
}
