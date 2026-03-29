export function printContractReport(output) {
  const { results, skipped } = output;

  console.log('\n========================================');
  console.log('TWD Contract Validation');
  console.log('========================================');

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
    console.log(`Source: ${source}`);
    console.log(`Mode: ${mode}`);
    console.log('');

    for (const result of sourceResults) {
      if (!result.validation.valid) {
        errorCount += result.validation.errors.length;
        console.log(`✗ ${result.method} ${result.matchedPath} (${result.status}) — mock "${result.alias}"`);
        for (const err of result.validation.errors) {
          console.log(`  - ${err.path}: ${err.message}`);
        }
        console.log('');
        if (result.mode === 'error') {
          hasContractErrors = true;
        }
      }

      for (const warning of result.validation.warnings) {
        warningCount++;
        console.log(`⚠ ${result.method} ${result.matchedPath} (${result.status}) — mock "${result.alias}"`);
        console.log(`  ${warning.message}`);
        console.log('');
      }
    }
  }

  for (const skip of skipped) {
    console.log(`ℹ Mock "${skip.alias}" — ${skip.url}`);
    console.log(`  ${skip.reason === 'urlRegex mock' ? 'Regex URL pattern (skipped)' : 'Does not match any path in spec (skipped)'}`);
    console.log('');
  }

  const validatedCount = results.length;

  if (errorCount === 0 && warningCount === 0) {
    console.log('All mocks match their API contracts.');
  }

  console.log(`Mocks validated: ${validatedCount} | Errors: ${errorCount} | Warnings: ${warningCount} | Skipped: ${skipped.length}`);
  console.log('========================================\n');

  return hasContractErrors;
}
