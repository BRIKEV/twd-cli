import { needsAttention, contractWarnings } from './needsAttention.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const ICON = { pass: '✓', fail: '✕', skip: '–' };

const CSS = `
:root { --bg:#fff; --fg:#1f2328; --muted:#57606a; --line:#d0d7de; --soft:#f6f8fa;
  --red:#cf222e; --red-bg:#fff8f8; --green:#1a7f37; --amber:#9a6700; }
@media (prefers-color-scheme: dark) { :root { --bg:#0d1117; --fg:#e6edf3; --muted:#8d96a0;
  --line:#30363d; --soft:#161b22; --red:#f85149; --red-bg:#1f1215; --green:#3fb950; --amber:#d29922; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 system-ui, sans-serif; }
main { max-width: 960px; margin: 0 auto; padding: 16px; }
.verdict { display:flex; flex-wrap:wrap; align-items:center; gap:12px; padding:12px 0; border-bottom:1px solid var(--line); }
.badge { font-weight:700; font-size:12px; letter-spacing:.04em; padding:3px 8px; border-radius:4px; color:#fff; }
.badge.passed { background:var(--green); } .badge.failed { background:var(--red); } .badge.interrupted { background:var(--amber); }
.stats { display:flex; flex-wrap:wrap; gap:12px; color:var(--muted); }
.stats b { color:var(--fg); }
h2 { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:20px 0 8px; }
.item { border-left:3px solid var(--red); background:var(--red-bg); padding:8px 10px; margin:0 0 8px; border-radius:0 4px 4px 0; }
.item .path { font-weight:600; overflow-wrap:anywhere; }
pre { font:12px/1.45 ui-monospace, monospace; white-space:pre-wrap; overflow-wrap:anywhere; margin:4px 0 0; color:var(--red); }
.chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
.chip { font-size:11px; border:1px solid var(--line); border-radius:10px; padding:1px 8px; color:var(--muted); }
img.diff { max-width:240px; margin-top:6px; border:1px solid var(--line); cursor:zoom-in; }
img.diff.big { max-width:100%; cursor:zoom-out; }
video { max-width:100%; margin-top:6px; }
details { border-top:1px solid var(--line); padding:8px 0; }
summary { cursor:pointer; font-weight:600; }
ul.rows { list-style:none; margin:8px 0 0; padding:0; }
ul.rows li { display:flex; gap:8px; padding:2px 0; overflow-wrap:anywhere; }
.pass { color:var(--green); } .fail { color:var(--red); } .skip, .muted { color:var(--muted); } .warn { color:var(--amber); }
.diag { white-space:pre-wrap; overflow-wrap:anywhere; margin-top:6px; }
`;

function verdict(report) {
  const { summary, run, outcome } = report;
  // A saved run.json is user-editable disk content, read back by `twd-cli
  // report` without re-deriving it, so outcome and every summary value are
  // escaped like any other field from it — not just the strings.
  const stats = [
    `<span><b>${esc(summary.passed)}</b> passed</span>`,
    `<span><b>${esc(summary.failed)}</b> failed</span>`,
    `<span><b>${esc(summary.skipped)}</b> skipped</span>`,
  ];
  if (summary.notRun) stats.push(`<span><b>${esc(summary.notRun)}</b> not run</span>`);
  if (report.contracts.configured) stats.push(`<span><b>${esc(summary.contracts.errors)}</b> contract errors</span>`);
  stats.push(`<span class="muted">${esc((run.durationMs / 1000).toFixed(1))}s · ${esc(run.url)} · ${esc(run.startedAt)}</span>`);
  return `<div class="verdict"><span class="badge ${esc(outcome)}">${esc(String(outcome).toUpperCase())}</span><div class="stats">${stats.join('')}</div></div>`;
}

function image(file, images) {
  return images[file]
    ? `<img class="diff" alt="Layout diff" src="${images[file]}" onclick="this.classList.toggle('big')">`
    : `<div class="muted">Capture ${esc(file)} could not be read.</div>`;
}

function item(entry, images) {
  if (entry.kind === 'test') {
    const chips = [];
    if (entry.attempts > 1) chips.push(`<span class="chip">${entry.attempts} attempts</span>`);
    return `<div class="item"><div class="path">${esc(entry.path)}</div>`
      + (entry.error ? `<pre>${esc(entry.error)}</pre>` : '')
      + (chips.length ? `<div class="chips">${chips.join('')}</div>` : '')
      + (entry.snapshot ? image(entry.snapshot.file, images) : '')
      + (entry.recording ? `<video controls preload="none" src="${esc(entry.recording)}"></video>` : '')
      + '</div>';
  }
  if (entry.kind === 'snapshot') {
    return `<div class="item"><div class="path">Layout snapshot ${esc(entry.name)} differs</div>${image(entry.file, images)}</div>`;
  }
  const errors = entry.errors.map((e) => `${e.path}: ${e.message}`).join('\n');
  const usedBy = entry.testName ? `<span class="chip">used by ${esc(entry.testName)}</span>` : '';
  return `<div class="item"><div class="path">Contract · ${esc(`${entry.method} ${entry.matchedPath} ${entry.status}`)} (${esc(entry.alias)})</div>`
    + `<pre>${esc(errors)}</pre><div class="chips"><span class="chip">${esc(entry.spec)} · error mode</span>${usedBy}</div></div>`;
}

function allTests(report) {
  const rows = [...report.tests]
    .sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity))
    .map((t) => `<li><span class="${t.status}">${ICON[t.status] ?? '?'}</span>${esc(t.path ?? t.id)}</li>`);
  return `<details><summary>All tests (${report.tests.length})</summary><ul class="rows">${rows.join('')}</ul></details>`;
}

function contracts(report) {
  if (!report.contracts.configured) return '';
  const c = report.summary.contracts;

  // Group warnings by spec
  const warningsBySpec = new Map();
  for (const w of contractWarnings(report)) {
    if (!warningsBySpec.has(w.spec)) {
      warningsBySpec.set(w.spec, []);
    }
    warningsBySpec.get(w.spec).push(w);
  }

  // Build warning rows grouped by spec
  let warningRows = '';
  for (const [spec, warnings] of warningsBySpec) {
    warningRows += `<li class="muted">${esc(spec)}</li>`;
    for (const w of warnings) {
      warningRows += `<li><span class="warn">⚠</span>${esc(`${w.method} ${w.matchedPath} ${w.status}`)} (${esc(w.alias)}): ${esc(w.messages.join('; '))}</li>`;
    }
  }

  // Build skipped rows
  const skipped = report.contracts.skipped.map((s) =>
    `<li><span class="skip">–</span>${esc(s.url)} <span class="muted">${esc(s.reason)}</span></li>`);
  if (skipped.length > 0) {
    warningRows += `<li class="muted">Skipped</li>${skipped.join('')}`;
  }

  return `<details><summary>Contracts: ${esc(c.passed)} passed · ${esc(plural(c.errors, 'error'))} · ${esc(plural(c.warnings, 'warning'))} · ${esc(c.skipped)} skipped</summary>`
    + `<ul class="rows">${warningRows}</ul></details>`;
}

function artifacts(report) {
  const rows = report.recordings.map((r) => `<li><a href="${esc(r.file)}">${esc(r.file)}</a></li>`);
  if (report.coverage) rows.push(`<li>Coverage: ${esc(report.coverage.file)}</li>`);
  if (!rows.length) return '';
  return `<details><summary>Artifacts</summary><ul class="rows">${rows.join('')}</ul></details>`;
}

export function renderHtml(report, { images = {} } = {}) {
  const items = needsAttention(report);
  let body = verdict(report);

  if (report.outcome === 'interrupted') {
    // The diagnostic is prose, not a stack trace, so it gets its own class
    // rather than <pre>'s red: white-space:pre-wrap keeps its line breaks
    // without borrowing the error's color.
    body += `<h2>Run interrupted</h2><div class="item"><pre>${esc(report.error.message)}</pre>`
      + (report.error.diagnostic ? `<div class="diag">${esc(report.error.diagnostic)}</div>` : '') + '</div>';
  }
  if (items.length) {
    body += `<h2>Needs attention (${items.length})</h2>${items.map((e) => item(e, images)).join('')}`;
  }
  body += allTests(report) + contracts(report) + artifacts(report);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TWD run report</title>
<style>${CSS}</style>
</head>
<body><main>${body}</main></body>
</html>
`;
}
