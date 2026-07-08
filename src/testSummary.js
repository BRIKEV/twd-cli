import { buildTestPath } from './buildTestPath.js';

export function formatRunComplete({ testStatus, handlers, durationMs }) {
  const passed = testStatus.filter((t) => t.status === 'pass').length;
  const failed = testStatus.filter((t) => t.status === 'fail').length;
  const skipped = testStatus.filter((t) => t.status === 'skip').length;
  const duration = (durationMs / 1000).toFixed(1);

  const lines = [
    '--- Run complete ---',
    `  Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped}`,
    `  Duration: ${duration}s`,
  ];

  const failures = testStatus.filter((t) => t.status === 'fail');
  if (failures.length > 0) {
    lines.push('', `  Failed tests (${failures.length}):`);
    for (const failure of failures) {
      const testPath = buildTestPath(failure.id, handlers) ?? failure.id;
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
      const testPath = buildTestPath(t.id, handlers) ?? t.id;
      lines.push(`    ✓ ${testPath} (passed on attempt ${t.retryAttempt})`);
    }
  }

  return lines.join('\n');
}
