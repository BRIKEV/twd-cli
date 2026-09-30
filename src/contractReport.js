import { formatMockLabel } from './formatMockLabel.js';

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const boldRed = (s) => `\x1b[1;31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const boldYellow = (s) => `\x1b[1;33m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bgRed = (s) => `\x1b[41;97m${s}\x1b[0m`;
const bgYellow = (s) => `\x1b[43;30m${s}\x1b[0m`;

export function printContractReport(output) {
  const { results, skipped } = output;

  console.log('');
  console.log(bold('========================================'));
  console.log(bold('TWD Contract Validation'));
  console.log(bold('========================================'));

  let errorCount = 0;
  let warningCount = 0;
  let hasContractErrors = false;

  // Group results by spec source
  const bySource = new Map();
  for (const result of results) {
    const key = result.specSource;
    if (!bySource.has(key)) {
      bySource.set(key, []);
    }
    bySource.get(key).push(result);
  }

  // Passing mocks and skips are counted, not listed: run.json and index.html hold the detail.
  for (const [source, sourceResults] of bySource) {
    const noisy = sourceResults.filter((r) => !r.validation.valid || r.validation.warnings.length > 0);
    if (noisy.length === 0) continue;

    const mode = sourceResults[0]?.mode || 'warn';
    const modeLabel = mode === 'error'
      ? bgRed(` ${mode.toUpperCase()} `)
      : bgYellow(` ${mode.toUpperCase()} `);
    console.log(`${cyan('Source:')} ${source}  ${modeLabel}`);
    console.log('');

    for (const result of noisy) {
      const failColor = result.mode === 'error' ? boldRed : boldYellow;
      const detailColor = result.mode === 'error' ? red : yellow;

      if (!result.validation.valid) {
        errorCount += result.validation.errors.length;
        console.log(failColor(`  MOCK ✗ ${result.method} ${result.matchedPath} (${result.status}) — ${formatMockLabel(result)}`));
        for (const err of result.validation.errors) {
          console.log(detailColor(`    → ${err.path}: ${err.message}`));
        }
        console.log('');
        if (result.mode === 'error') {
          hasContractErrors = true;
        }
      }

      for (const warning of result.validation.warnings) {
        warningCount++;
        console.log(yellow(`  MOCK ⚠ ${result.method} ${result.matchedPath} (${result.status}) — ${formatMockLabel(result)}`));
        console.log(yellow(`    ${warning.message}`));
        console.log('');
      }
    }
  }

  const validatedCount = results.length;

  if (errorCount === 0 && warningCount === 0) {
    console.log(green('All mocks match their API contracts.'));
  }

  const summary = `Mocks validated: ${bold(validatedCount)} | Errors: ${errorCount > 0 ? boldRed(errorCount) : green(errorCount)} | Warnings: ${warningCount > 0 ? boldYellow(warningCount) : green(warningCount)} | Skipped: ${dim(skipped.length)}`;
  console.log(summary);
  console.log(bold('========================================\n'));

  return hasContractErrors;
}
