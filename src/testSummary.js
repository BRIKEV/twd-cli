import { buildTestPath } from './buildTestPath.js';

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

export function formatRunComplete({
  testStatus,
  handlers,
  durationMs,
  notRun = 0,
  stoppedEarly = false,
  maxFailures,
  shards = null,
  computeMs = null,
}) {
  const passed = testStatus.filter((t) => t.status === 'pass').length;
  const failed = testStatus.filter((t) => t.status === 'fail').length;
  const skipped = testStatus.filter((t) => t.status === 'skip').length;
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

  const failures = testStatus.filter((t) => t.status === 'fail');
  if (failures.length > 0) {
    lines.push('', `  Failed tests (${failures.length}):`);
    for (const failure of failures) {
      const testPath = resolvePath(failure, handlers);
      lines.push(`    × ${testPath}`);
      if (failure.error) {
        lines.push(`      ${String(failure.error).replace(/\n/g, '\n      ')}`);
      }
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

  return lines.join('\n');
}
