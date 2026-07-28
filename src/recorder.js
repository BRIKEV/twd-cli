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

/**
 * Holds the opening state before the first test runs.
 *
 * A plain wait is enough here. The first screencast frame arrives when capture
 * starts, and it is held until the first test changes something, so the opening
 * state simply occupies that much of the timeline.
 */
export async function holdOpeningFrame(durationMs) {
  if (!durationMs || durationMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, durationMs));
}

/**
 * Holds the final state at the end of a recording, and makes sure it is
 * actually captured.
 *
 * A plain wait does NOT work here, which is the whole reason this exists.
 * Puppeteer's frame pipeline uses `bufferCount(2, 1)`: every screencast frame is
 * held until the next one arrives, because the next frame's timestamp is what
 * says how long to display the current one. The newest frame is therefore never
 * emitted, and `stop()` pads the tail by repeating the second-newest. A settled
 * page produces no further compositor updates, so the last thing a test did is
 * lost no matter how long you wait.
 *
 * Measured against real Chrome: stopping immediately ended two states early; a
 * 400ms wait still ended one state early; an 800ms wait with a 1px animated
 * probe produced no new frames at all, because a 1px element gets its own
 * composited layer and changes no visible surface.
 *
 * Toggling a viewport-sized overlay between two near-identical alpha values
 * repaints the whole surface, so Chrome must emit real frames, while staying
 * invisible in the output. That flushes the true final state through the
 * pipeline and then holds it.
 */
export async function holdFinalFrame(page, durationMs) {
  if (!durationMs || durationMs <= 0) return;

  await page.evaluate(async (ms) => {
    const veil = document.createElement('div');
    veil.style.cssText = [
      'position:fixed',
      'inset:0',
      'pointer-events:none',
      'z-index:2147483647',
      'background:rgba(255,255,255,0)',
    ].join(';');
    document.body.appendChild(veil);

    try {
      const deadline = performance.now() + ms;
      let lit = false;
      while (performance.now() < deadline) {
        lit = !lit;
        veil.style.background = lit ? 'rgba(255,255,255,0.004)' : 'rgba(255,255,255,0)';
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      veil.remove();
    }
  }, durationMs);
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
