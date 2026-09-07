import fs from 'fs';
import path from 'path';
import { spawnSync } from 'node:child_process';
import { DEBUG_PREFIXES, debug } from 'puppeteer';

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
 * Movflags puppeteer's screencast passes, per output format.
 *
 * This mirrors `ScreenRecorder#getFormatArgs` in puppeteer-core, where mp4 is
 * the only format carrying `-movflags`. The list belongs to puppeteer rather
 * than to us, so it can change on any puppeteer bump: re-read that method when
 * upgrading. That is also the argument for probing the capability instead of
 * pinning a version floor — the flags move independently of ffmpeg's numbering.
 */
const REQUIRED_MOVFLAGS = { mp4: ['hybrid_fragmented'] };

function detectVersion(stdout) {
  const match = /ffmpeg version (\S+)/.exec(stdout || '');
  return match ? match[1] : null;
}

function movflagHelp(ffmpegPath, version, missing) {
  const subject = version ? `ffmpeg ${version}` : `ffmpeg at ${ffmpegPath}`;
  const flags = missing.map((flag) => `\`-movflags ${flag}\``).join(', ');
  return [
    `${subject} does not support ${flags}, which recording requires.`,
    '',
    'Install ffmpeg 8 or newer, or set record.ffmpegPath to one.',
    'Measured: 6.1.1 (Ubuntu 24.04) no, 7.0.2 (static build) no, 8.1.2 yes —',
    'so "not the distro build" is not enough on its own.',
  ].join('\n');
}

/**
 * Probes ffmpeg before the browser launches, for what recording actually needs.
 *
 * Puppeteer probes internally too, but only once the recorder is constructed,
 * which is after launch and navigation. Failing here saves a wasted run and
 * gives an actionable message.
 *
 * Existence is not the requirement, which is what this originally checked. An
 * ffmpeg that runs but rejects puppeteer's arguments fails at the first frame,
 * after the whole run has been set up, with nothing on stdout to say why. So
 * the muxer probe asks whether this binary understands the flags it will be
 * given.
 */
export function assertFfmpegCapable(ffmpegPath, format) {
  const version = spawnSync(ffmpegPath, ['-version'], { encoding: 'utf8' });
  if (version.error) {
    throw new Error(FFMPEG_INSTALL_HELP);
  }

  const required = REQUIRED_MOVFLAGS[format] || [];
  if (required.length === 0) return;

  const probe = spawnSync(ffmpegPath, ['-hide_banner', '-h', `muxer=${format}`], { encoding: 'utf8' });
  const help = `${probe.stdout || ''}${probe.stderr || ''}`;
  // An unreadable probe is not evidence of an incapable ffmpeg. A dead encode
  // is bounded and diagnosable now (see watchRecorder), so guessing "broken"
  // here would ground a working setup to avoid a failure that reports itself.
  if (probe.error || !help) return;

  const missing = required.filter((flag) => !help.includes(flag));
  if (missing.length > 0) {
    throw new Error(movflagHelp(ffmpegPath, detectVersion(version.stdout), missing));
  }
}

/**
 * How long to wait for a healthy recorder to finalize before giving up.
 *
 * stop() only pads the tail with `fps * (now - lastFrameTimestamp)` frames and
 * closes stdin, so a real finalize is well under a second. This bound exists for
 * the ways ffmpeg can die that `watchRecorder` does not see in time — the
 * encoder going away between the last health check and the stop.
 */
export const STOP_TIMEOUT_MS = 30000;

const FFMPEG_LOG_LIMIT = 20;

/**
 * A puppeteer `logger` that captures ffmpeg's stderr.
 *
 * Puppeteer spawns ffmpeg itself and routes its stderr to this channel and
 * nowhere else, so without this the only way to learn why an encode failed is to
 * point record.ffmpegPath at a wrapper script that tees the output. That is a
 * lot to ask of someone whose CI job just hung.
 *
 * Other channels are delegated rather than dropped: `puppeteer.launch` does
 * `options.logger ??= debug`, so supplying a logger replaces the default
 * outright, and swallowing the rest would quietly disable NODE_DEBUG.
 */
export function createFfmpegLog({ fallback = debug, limit = FFMPEG_LOG_LIMIT } = {}) {
  const lines = [];

  const logger = (prefix) => {
    if (prefix !== DEBUG_PREFIXES.ffmpeg) return fallback(prefix);
    return (...args) => {
      for (const arg of args) {
        const text = String(arg).trim();
        if (text) lines.push(text);
      }
      if (lines.length > limit) lines.splice(0, lines.length - limit);
    };
  };

  return { logger, lines };
}

/**
 * Watches a screencast for its encoder dying mid-run.
 *
 * The recorder puppeteer returns is a PassThrough that ffmpeg's stdout is piped
 * into, so the stream ending is the encoder exiting. Nothing else reports it:
 * the child process is private, and a failed frame write is only ever printed,
 * never thrown.
 *
 * Detecting it is worth doing on its own, but the abort is why this runs at the
 * moment of death rather than at stop time. Puppeteer keeps pushing frames into
 * a destroyed stdin for the rest of the run — one `ffmpeg failed to write` line
 * each — and stop() aborting the frame pipeline is the only thing that ends it.
 */
export function watchRecorder(recorder) {
  const health = { encoderDied: false };

  const onEnd = () => {
    if (health.encoderDied) return;
    health.encoderDied = true;
    // Deliberately not awaited: this is the call that hangs once ffmpeg is gone.
    Promise.resolve(recorder.stop()).catch(() => {});
  };

  recorder.once('end', onEnd);
  recorder.once('close', onEnd);

  health.release = () => {
    recorder.off('end', onEnd);
    recorder.off('close', onEnd);
  };

  return health;
}

/**
 * Finalizes a screencast without ever hanging on it.
 *
 * puppeteer's `stop()` ends with `await new Promise(r => process.once('close', r))`.
 * When ffmpeg already exited — a rejected argument, a full disk — that event
 * fired long ago and the listener is never called again, so the await is
 * permanent. Observed cost: an entire GitHub Actions job, on a suite whose tests
 * had all finished.
 *
 * So a known-dead encoder is never awaited, and a live one is raced against a
 * deadline for the deaths the watcher could not see coming.
 */
export async function stopRecording(recorder, health = {}, timeoutMs = STOP_TIMEOUT_MS) {
  const died = Boolean(health.encoderDied);
  // Before stopping, not after: a healthy stop() ends the stream too, and a
  // still-attached watcher would read its own shutdown as a death.
  health.release?.();

  if (died) {
    Promise.resolve(recorder.stop()).catch(() => {});
    return { ok: false, reason: 'ffmpeg exited during the run' };
  }

  let timer;
  try {
    const outcome = await Promise.race([
      Promise.resolve(recorder.stop()).then(() => 'stopped', (error) => error),
      new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), timeoutMs); }),
    ]);

    if (outcome === 'stopped') return { ok: true };
    if (outcome === 'timeout') {
      return { ok: false, reason: `ffmpeg did not finish within ${timeoutMs}ms` };
    }
    return { ok: false, reason: outcome.message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Re-encodes a finished recording into something that opens anywhere.
 *
 * puppeteer feeds ffmpeg PNG frames and never passes `-pix_fmt`, so RGB is
 * carried straight into VP9 (profile 1) and the artifact lands as vp9/gbrp in an
 * mp4 container. That file is not broken — it decodes frame for frame — but
 * QuickTime and Preview cannot open VP9 at all, and `gbrp` is exotic even for
 * players that can. Double-clicking it looks exactly like a failed run.
 *
 * H.264 + yuv420p plays everywhere, and measured on a real 111-frame capture it
 * is also about a quarter of the size. `+faststart` puts the index first, so it
 * streams rather than waiting on a full download.
 *
 * Failure is not fatal: the untranscoded file is still a correct recording, and
 * an ffmpeg build without libx264 should cost a convenience, not the artifact.
 */
export function transcodeForPlayback(ffmpegPath, filePath) {
  const extension = path.extname(filePath);
  const stem = path.basename(filePath, extension);
  // ffmpeg picks its muxer from the output extension, so the temp file has to
  // keep it. Same directory, so the replacement is a rename and not a copy.
  const tempPath = path.join(path.dirname(filePath), `.${stem}.h264${extension}`);

  const result = spawnSync(ffmpegPath, [
    '-y',
    '-loglevel', 'error',
    '-i', filePath,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    tempPath,
  ], { encoding: 'utf8' });

  if (result.error || result.status !== 0) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // A leftover temp file is not worth failing a finished run over.
    }
    return { ok: false, reason: transcodeReason(result) };
  }

  fs.renameSync(tempPath, filePath);
  return { ok: true };
}

function transcodeReason(result) {
  if (result.error) return result.error.message;
  const lines = String(result.stderr || '').split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.at(-1) || `ffmpeg exited with code ${result.status}`;
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
