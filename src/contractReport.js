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

  for (const [source, sourceResults] of bySource) {
    const mode = sourceResults[0]?.mode || 'warn';
    const modeLabel = mode === 'error'
      ? bgRed(` ${mode.toUpperCase()} `)
      : bgYellow(` ${mode.toUpperCase()} `);
    console.log(`${cyan('Source:')} ${source}  ${modeLabel}`);
    console.log('');

    for (const result of sourceResults) {
      const failColor = result.mode === 'error' ? boldRed : boldYellow;
      const detailColor = result.mode === 'error' ? red : yellow;

      if (!result.validation.valid) {
        errorCount += result.validation.errors.length;
        console.log(failColor(`  ✗ ${result.method} ${result.matchedPath} (${result.status}) — mock "${result.alias}"`));
        for (const err of result.validation.errors) {
          console.log(detailColor(`    → ${err.path}: ${err.message}`));
        }
        console.log('');
        if (result.mode === 'error') {
          hasContractErrors = true;
        }
      } else if (result.validation.warnings.length === 0) {
        console.log(green(`  ✓ ${result.method} ${result.matchedPath} (${result.status}) — mock "${result.alias}"`));
      }

      for (const warning of result.validation.warnings) {
        warningCount++;
        console.log(yellow(`  ⚠ ${result.method} ${result.matchedPath} (${result.status}) — mock "${result.alias}"`));
        console.log(yellow(`    ${warning.message}`));
        console.log('');
      }
    }
  }

  if (skipped.length > 0) {
    console.log(dim('Skipped:'));
    for (const skip of skipped) {
      console.log(dim(`  ℹ "${skip.alias}" — ${skip.url}`));
      console.log(dim(`    ${skip.reason === 'urlRegex mock' ? 'Regex URL pattern' : 'No matching path in any spec'}`));
    }
    console.log('');
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
