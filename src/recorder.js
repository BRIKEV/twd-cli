import fs from 'fs';
import path from 'path';
import { spawnSync } from 'node:child_process';

/**
 * Hides the TWD sidebar for the duration of a recording.
 *
 * The html margin reset is not optional. twd-js's useLayout hook writes
 * `document.documentElement.style.marginLeft = '280px'` as an inline style while
 * the sidebar is open, so hiding the sidebar root on its own leaves a blank
 * gutter in frame. `!important` is what beats the inline style, and it survives
 * re-renders that would otherwise reapply the margin.
 */
export const FRAMING_CSS = [
  '#twd-sidebar-root { display: none !important; }',
  'html { margin-left: 0 !important; margin-right: 0 !important; }',
].join('\n');

const FFMPEG_INSTALL_HELP = [
  'Recording requires ffmpeg, which was not found.',
  '',
  '  macOS:   brew install ffmpeg',
  '  Linux:   sudo apt-get install ffmpeg',
  '  Windows: winget install ffmpeg',
  '',
  'Or set record.ffmpegPath in twd.config.json to an explicit binary path.',
].join('\n');

/**
 * Probes for ffmpeg before the browser launches.
 *
 * Puppeteer probes internally too, but only once the recorder is constructed,
 * which is after launch and navigation. Failing here saves a wasted run and
 * gives an actionable message.
 */
export function assertFfmpegAvailable(ffmpegPath) {
  const { error } = spawnSync(ffmpegPath, ['-version']);
  if (error) {
    throw new Error(FFMPEG_INSTALL_HELP);
  }
}

export async function applyRecordingFraming(page, record) {
  if (!record.hideSidebar) return;
  await page.addStyleTag({ content: FRAMING_CSS });
}

export async function startRecording(page, record, outputPath) {
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const options = {
    path: outputPath,
    format: record.format,
    fps: record.fps,
    overwrite: true,
    // Puppeteer spawns ffmpeg itself and defaults to a bare `ffmpeg` on PATH.
    // Without this the pre-flight probe would honor record.ffmpegPath while the
    // actual encode still failed with ENOENT, after launch and navigation.
    ffmpegPath: record.ffmpegPath,
  };

  // Puppeteer adds a `setpts` filter for any truthy speed, so a speed of 1
  // would add a no-op filter rather than none at all.
  if (record.speed && record.speed !== 1) {
    options.speed = record.speed;
  }

  return page.screencast(options);
}
