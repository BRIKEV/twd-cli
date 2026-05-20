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
