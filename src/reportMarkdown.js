import { needsAttention, contractWarnings } from './needsAttention.js';

export const MARKDOWN_ITEM_CAP = 20;
// GitHub rejects a PR comment over 65,536 characters.
export const MARKDOWN_MAX_CHARS = 60000;
const LINE_CAP = 300;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const escapeMd = (s) => String(s).replace(/[\\`*_<>[\]|]/g, '\\$&');
const code = (s) => `\`${String(s).replace(/`/g, "'")}\``;
const pretty = (path) => String(path).replace(/ > /g, ' › ');

function firstLine(text) {
  const line = String(text ?? '').split('\n')[0];
  return line.length > LINE_CAP ? `${line.slice(0, LINE_CAP)}…` : line;
}

// A fence no longer than the text's own longest backtick run would close
// early if the error message itself contains one (a code block in a stack
// trace, say). One backtick longer than the longest run guarantees it can't.
function fenceFor(text) {
  const runs = String(text ?? '').match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

function heading(report) {
  const { summary, outcome } = report;
  if (outcome === 'interrupted') return '### ⚠️ TWD: run interrupted';
  if (outcome === 'passed') return `### ✅ TWD: ${summary.passed} passed`;
  const parts = [];
  if (summary.failed) parts.push(`${plural(summary.failed, 'test')} failed`);
  if (summary.contracts.errors) parts.push(plural(summary.contracts.errors, 'contract error'));
  return `### ❌ TWD: ${parts.join(', ') || 'run failed'}`;
}

function table(report) {
  const { summary, contracts, run } = report;
  const cols = ['Passed', 'Failed', 'Skipped'];
  const cells = [summary.passed, summary.failed, summary.skipped];
  if (contracts.configured) {
    const c = summary.contracts;
    cols.push('Contracts');
    cells.push(`${c.passed} ✓ · ${c.errors} ✕ · ${c.warnings} ⚠`);
  }
  cols.push('Duration');
  cells.push(`${(run.durationMs / 1000).toFixed(1)}s`);
  return [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, `| ${cells.join(' | ')} |`];
}

function item(entry) {
  if (entry.kind === 'test') {
    const retried = entry.attempts > 1 ? ` _(${entry.attempts} attempts)_` : '';
    const lines = [`- ❌ **${escapeMd(pretty(entry.path))}**${retried}`];
    if (entry.error) lines.push(`  > ${code(firstLine(entry.error))}`);
    if (entry.snapshot) lines.push(`  > Layout snapshot ${code(entry.snapshot.name)} differs, diff in the report`);
    return lines;
  }
  if (entry.kind === 'snapshot') {
    return [`- ❌ **Layout snapshot** ${code(entry.name)} differs, diff in the report`];
  }
  const [err] = entry.errors ?? [];
  const usedBy = entry.testName ? ` Used by _${escapeMd(pretty(entry.testName))}_` : '';
  const lines = [
    `- ❌ **Contract** ${code(`${entry.method} ${entry.matchedPath} ${entry.status}`)} (${escapeMd(entry.alias)}), ${escapeMd(entry.spec)}`,
  ];
  // needsAttention only guarantees mode + validity, not that errors[] is
  // non-empty, so a validation shaped without one still gets a contract line.
  if (err) lines.push(`  > ${code(err.path)}: ${escapeMd(firstLine(err.message))}.${usedBy}`);
  return lines;
}

export function renderMarkdown(report) {
  const lines = [heading(report), ''];

  if (report.outcome === 'interrupted') {
    const message = firstLine(report.error.message);
    const fence = fenceFor(message);
    lines.push(fence, message, fence);
    if (report.error.diagnostic) lines.push('', escapeMd(report.error.diagnostic));
    lines.push('');
  }

  lines.push(...table(report), '');

  const items = needsAttention(report);
  if (items.length) {
    lines.push('#### Needs attention');
    for (const entry of items.slice(0, MARKDOWN_ITEM_CAP)) lines.push(...item(entry));
    if (items.length > MARKDOWN_ITEM_CAP) {
      lines.push(`- …and ${items.length - MARKDOWN_ITEM_CAP} more, see \`index.html\``);
    }
    lines.push('');
  }

  if (report.summary.stoppedEarly) {
    lines.push(`⚠ Stopped early at the failure limit: ${report.summary.notRun} not run.`, '');
  }

  const warnings = contractWarnings(report);
  if (warnings.length) {
    lines.push(`<details><summary>${plural(warnings.length, 'contract warning')}</summary>`, '');
    for (const w of warnings.slice(0, MARKDOWN_ITEM_CAP)) {
      lines.push(`- ${code(`${w.method} ${w.matchedPath} ${w.status}`)} (${escapeMd(w.alias)}): ${escapeMd(firstLine(w.messages[0]))}`);
    }
    lines.push('', '</details>', '');
  }

  if (report.outcome !== 'passed') {
    const clips = report.recordings.length ? ` · ${plural(report.recordings.length, 'recording')}` : '';
    lines.push(`Full report: \`index.html\` in the report folder${clips}`);
  }

  const out = `${lines.join('\n').trimEnd()}\n`;
  return out.length < MARKDOWN_MAX_CHARS ? out : `${out.slice(0, MARKDOWN_MAX_CHARS - 40)}\n\n…truncated, see \`index.html\`\n`;
}
