import { formatDuration } from './formatDuration.js';

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

export function formatTestSummary({ testStatus, durationMs }) {
  const passed = testStatus.filter((t) => t.status === 'pass').length;
  const failed = testStatus.filter((t) => t.status === 'fail').length;
  const skipped = testStatus.filter((t) => t.status === 'skip').length;
  const total = testStatus.length;

  const passedStr = `${green(passed)} passed`;
  const failedStr = `${failed > 0 ? red(failed) : '0'} failed`;
  const skippedStr = `${skipped > 0 ? yellow(skipped) : '0'} skipped`;

  return `Tests: ${passedStr}, ${failedStr}, ${skippedStr} (${total} total) in ${formatDuration(durationMs)}`;
}

export function formatFailedTestsBlock({ testStatus, handlers }) {
  const failures = testStatus.filter((t) => t.status === 'fail');
  if (failures.length === 0) return null;

  const handlersById = new Map(handlers.map((h) => [h.id, h]));
  const lines = ['Failed tests:'];
  for (const failure of failures) {
    const handler = handlersById.get(failure.id);
    const name = handler ? handler.name : failure.id;
    lines.push(`  ${red('✗')} ${name}`);
  }
  return lines.join('\n');
}
