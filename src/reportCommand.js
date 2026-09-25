import { readReport, loadSnapshotImages, DEFAULT_REPORT_DIR } from './reportFiles.js';
import { renderHtml } from './reportHtml.js';
import { renderMarkdown } from './reportMarkdown.js';

export function renderReport({ input = null, format = 'markdown' } = {}) {
  const { report, dir } = readReport(input ?? DEFAULT_REPORT_DIR);
  if (format === 'json') return `${JSON.stringify(report, null, 2)}\n`;
  if (format === 'html') return renderHtml(report, { images: loadSnapshotImages(dir, report.snapshots) });
  return renderMarkdown(report);
}
