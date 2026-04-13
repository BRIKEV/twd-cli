import { formatMockLabel } from './formatMockLabel.js';

function formatMockLabelMd(result) {
  // Reuse the plain-text label but replace quoted alias with backtick-wrapped alias
  return formatMockLabel(result).replace(`"${result.alias}"`, `\`${result.alias}\``);
}

export function generateContractMarkdown(output) {
  const { results, skipped } = output;
  const lines = [];

  lines.push('## TWD Contract Validation');
  lines.push('');

  // Group results by spec source
  const bySource = new Map();
  for (const result of results) {
    if (!bySource.has(result.specSource)) {
      bySource.set(result.specSource, []);
    }
    bySource.get(result.specSource).push(result);
  }

  // Build summary table
  lines.push('| Spec | Passed | Failed | Warnings | Mode |');
  lines.push('|------|--------|--------|----------|------|');

  let totalPassed = 0;
  let totalFailed = 0;
  let totalWarnings = 0;

  for (const [source, sourceResults] of bySource) {
    const mode = sourceResults[0]?.mode || 'warn';
    let passed = 0;
    let failed = 0;
    let warnings = 0;

    for (const r of sourceResults) {
      if (!r.validation.valid) {
        failed++;
      } else if (r.validation.warnings.length > 0) {
        warnings += r.validation.warnings.length;
      } else {
        passed++;
      }
    }

    totalPassed += passed;
    totalFailed += failed;
    totalWarnings += warnings;

    const modeLabel = mode === 'error' ? '`error`' : '`warn`';
    const failedCell = failed > 0 ? `**${failed}**` : '0';
    const warningsCell = warnings > 0 ? `**${warnings}**` : '0';

    lines.push(`| \`${source}\` | ${passed} | ${failedCell} | ${warningsCell} | ${modeLabel} |`);
  }

  lines.push('');

  // Totals line
  const parts = [];
  parts.push(`**${totalPassed} passed**`);
  if (totalFailed > 0) {
    parts.push(`**${totalFailed} failed**`);
  } else {
    parts.push('0 failed');
  }
  if (totalWarnings > 0) {
    parts.push(`**${totalWarnings} warnings**`);
  } else {
    parts.push('0 warnings');
  }
  if (skipped.length > 0) {
    parts.push(`${skipped.length} skipped`);
  }
  lines.push(parts.join(' · '));

  // If there are failures, show a collapsed details section
  const failedResults = results.filter(r => !r.validation.valid);
  if (failedResults.length > 0) {
    lines.push('');
    lines.push('<details>');
    lines.push('<summary>Failed validations</summary>');
    lines.push('');

    for (const [source, sourceResults] of bySource) {
      const failures = sourceResults.filter(r => !r.validation.valid);
      if (failures.length === 0) continue;

      lines.push(`**${source}**`);
      lines.push('');

      for (const r of failures) {
        lines.push(`- \`${r.method} ${r.matchedPath}\` (${r.status}) — ${formatMockLabelMd(r)}`);
        for (const err of r.validation.errors) {
          lines.push(`  - \`${err.path}\`: ${err.message}`);
        }
      }
      lines.push('');
    }

    lines.push('</details>');
  }

  lines.push('');

  return lines.join('\n');
}
