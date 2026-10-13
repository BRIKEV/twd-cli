import { buildTestPath } from './buildTestPath.js';
import { formatFailureDiagnostics } from './failureDiagnostics.js';
import { isFlaky } from './repeat.js';

/**
 * Display name for one test result.
 *
 * `entry.path` is preferred because it was resolved inside the shard that ran
 * the test, where the handler map was valid. A merged report keeps only the
 * first shard's handlers, and twd-js ids are random per page load, so
 * buildTestPath cannot resolve anything from shards 2..n — every failure would
 * print a bare random id in the one place the merge exists to produce. The
 * buildTestPath call stays for a live, non-sharded run, whose entries carry no
 * path.
 */
function resolvePath(entry, handlers) {
  return entry.path ?? buildTestPath(entry.id, handlers) ?? entry.id;
}

function outcomeCounts(testStatus, repeat) {
  if (!(repeat > 1)) {
    return {
      passed: testStatus.filter((t) => t.status === 'pass').length,
      failed: testStatus.filter((t) => t.status === 'fail').length,
      skipped: testStatus.filter((t) => t.status === 'skip').length,
    };
  }
  return testStatus.reduce((totals, test) => {
    const passes = test.passes ?? 0;
    const skips = test.skips ?? 0;
    const runs = test.runs ?? 0;
    totals.passed += passes;
    totals.skipped += skips;
    totals.failed += runs - passes - skips;
    return totals;
  }, { passed: 0, failed: 0, skipped: 0 });
}

function pushResultLines(lines, test, handlers, marker, suffix) {
  const testPath = resolvePath(test, handlers);
  lines.push(`    ${marker} ${testPath}${suffix}`);
  for (const row of formatFailureDiagnostics(test.diagnostics)) {
    lines.push(`      ${row}`);
  }
  if (test.error) {
    lines.push(`      ${String(test.error).replace(/\n/g, '\n      ')}`);
  }
}

export function formatRunComplete({
  testStatus,
  handlers,
  durationMs,
  notRun = 0,
  stoppedEarly = false,
  maxFailures,
  shards = null,
  computeMs = null,
  reportPath = null,
  cpuThrottle = 1,
  repeat = null,
}) {
  const { passed, failed, skipped } = outcomeCounts(testStatus, repeat);
  const duration = (durationMs / 1000).toFixed(1);

  const lines = [
    '--- Run complete ---',
    `  Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped}`,
  ];
  if (notRun > 0) lines.push(`  Not run: ${notRun}`);

  // A merged run has two meaningful durations: the span the developer waited,
  // and the compute it consumed. A single run has only one, and its line must
  // stay byte-identical to what it has always printed.
  const merged = Array.isArray(shards) && shards.length > 1;
  if (merged) {
    const compute = (computeMs / 1000).toFixed(1);
    lines.push(`  Duration: ${duration}s wall | ${compute}s across ${shards.length} shards`);
    const cells = shards.map((s) => `${s.index} ${s.failed > 0 ? '✗' : '✓'}${s.executed}`);
    lines.push(`  Shards: ${cells.join(' | ')}`);
  } else {
    lines.push(`  Duration: ${duration}s`);
  }
  // Right under the duration it inflates. Only when active, so an unthrottled
  // block stays exactly what it has always been.
  if (cpuThrottle > 1) lines.push(`  CPU throttle: ${cpuThrottle}x`);
  if (repeat > 1) lines.push(`  Repeat: ${repeat}x`);

  const repeating = repeat > 1;
  const flaky = repeating ? testStatus.filter((t) => isFlaky(t)) : [];
  const failures = testStatus.filter((t) => t.status === 'fail' && !(repeating && isFlaky(t)));
  if (failures.length > 0) {
    lines.push('', `  Failed tests (${failures.length}):`);
    for (const failure of failures) {
      const suffix = repeating ? ` (${failure.passes ?? 0}/${failure.runs} passed)` : '';
      // The marker line, then diagnostics, then the error. A twd-js failure
      // message can carry a full accessible-roles dump, which would bury the
      // block if the error came first.
      pushResultLines(lines, failure, handlers, '×', suffix);
    }
  }

  if (flaky.length > 0) {
    lines.push('', `  Flaky (${flaky.length}):`);
    for (const test of flaky) {
      pushResultLines(lines, test, handlers, '~', ` (${test.passes}/${test.runs} passed)`);
    }
  }

  const retried = testStatus.filter((t) => t.status === 'pass' && t.retryAttempt >= 2);
  if (retried.length > 0) {
    lines.push('', `  Retried (${retried.length}):`);
    for (const t of retried) {
      const testPath = resolvePath(t, handlers);
      lines.push(`    ✓ ${testPath} (passed on attempt ${t.retryAttempt})`);
    }
  }

  if (stoppedEarly) {
    lines.push('', `⚠ Stopped early: reached the failure limit (maxFailures=${maxFailures}).`);
    if (notRun > 0) {
      lines.push(`  ${notRun} test(s) were not run. Fix the failures above, or set "maxFailures": 0 to run all.`);
    } else {
      lines.push('  Fix the failures above, or set "maxFailures": 0 to run all.');
    }
  }

  if (reportPath) lines.push('', `  Report: ${reportPath}`);

  return lines.join('\n');
}
