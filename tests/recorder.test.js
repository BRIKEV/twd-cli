import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from 'node:events';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
vi.mock('fs');

import { spawnSync } from 'node:child_process';
import fs from 'fs';
import {
  FRAMING_CSS,
  assertFfmpegCapable,
  createFfmpegLog,
  watchRecorder,
  stopRecording,
  transcodeForPlayback,
  applyRecordingFraming,
  startRecording,
  holdOpeningFrame,
  holdFinalFrame,
} from "../src/recorder.js";

const baseRecord = {
  dir: './twd-artifacts',
  format: 'mp4',
  fps: 30,
  speed: 1,
  hideSidebar: true,
  ffmpegPath: 'ffmpeg',
};

describe("FRAMING_CSS", () => {
  it("hides the sidebar and resets the html margins with !important", () => {
    expect(FRAMING_CSS).toContain('#twd-sidebar-root');
    expect(FRAMING_CSS).toContain('display: none !important');
    expect(FRAMING_CSS).toContain('margin-left: 0 !important');
    expect(FRAMING_CSS).toContain('margin-right: 0 !important');
  });
});

// Stands in for `ffmpeg -h muxer=mp4` output. The real thing lists one movflag
// per line; only the presence of the name matters here.
function muxerHelp(movflags) {
  return [
    'Muxer mp4 [MP4 (MPEG-4 Part 14)]:',
    '  -movflags          <flags>      E.......... MOV muxer flags (default 0)',
    ...movflags.map((flag) => `     ${flag}                     E.......... some description`),
  ].join('\n');
}

const ALL_MOVFLAGS = ['faststart', 'frag_keyframe', 'empty_moov', 'hybrid_fragmented'];

// Routes each spawnSync call by its arguments, so one mock can answer both the
// -version probe and the muxer capability probe.
function mockFfmpeg({ versionError, version = 'ffmpeg version 8.1.2', movflags = ALL_MOVFLAGS, muxerError } = {}) {
  vi.mocked(spawnSync).mockImplementation((_bin, args) => {
    if (args.includes('-version')) {
      return versionError
        ? { error: versionError }
        : { error: undefined, status: 0, stdout: `${version} Copyright (c) 2000-2026`, stderr: '' };
    }
    if (muxerError) return { error: muxerError, stdout: '', stderr: '' };
    return { error: undefined, status: 0, stdout: muxerHelp(movflags), stderr: '' };
  });
}

describe("assertFfmpegCapable", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns when the binary runs and its mp4 muxer has every required movflag", () => {
    mockFfmpeg();

    expect(() => assertFfmpegCapable('ffmpeg', 'mp4')).not.toThrow();
    expect(spawnSync).toHaveBeenCalledWith('ffmpeg', ['-version'], expect.anything());
  });

  it("throws with install instructions when the binary is missing", () => {
    mockFfmpeg({ versionError: new Error('spawnSync ffmpeg ENOENT') });

    expect(() => assertFfmpegCapable('ffmpeg', 'mp4')).toThrow(/brew install ffmpeg/);
  });

  it("rejects an ffmpeg whose mp4 muxer does not understand hybrid_fragmented", () => {
    // The 6.1.1 case. Checking the version number instead would be a moving
    // target: the flags come from puppeteer, not from us.
    mockFfmpeg({ version: 'ffmpeg version 6.1.1-3ubuntu5', movflags: ['faststart', 'frag_keyframe'] });

    expect(() => assertFfmpegCapable('ffmpeg', 'mp4')).toThrow(/hybrid_fragmented/);
  });

  it("names the detected version and the way out in the rejection", () => {
    mockFfmpeg({ version: 'ffmpeg version 6.1.1-3ubuntu5', movflags: [] });

    expect(() => assertFfmpegCapable('ffmpeg', 'mp4')).toThrow(/6\.1\.1-3ubuntu5/);
    expect(() => assertFfmpegCapable('ffmpeg', 'mp4')).toThrow(/record\.ffmpegPath/);
  });

  it("probes the muxer with -h muxer=mp4", () => {
    mockFfmpeg();

    assertFfmpegCapable('ffmpeg', 'mp4');

    expect(spawnSync).toHaveBeenCalledWith(
      'ffmpeg',
      expect.arrayContaining(['-h', 'muxer=mp4']),
      expect.anything()
    );
  });

  it("skips the muxer probe for formats that pass no movflags", () => {
    mockFfmpeg();

    assertFfmpegCapable('ffmpeg', 'webm');

    expect(spawnSync).toHaveBeenCalledTimes(1);
  });

  it("proceeds when the muxer probe itself yields nothing to read", () => {
    // An unreadable probe is not evidence of an incapable ffmpeg, and a dead
    // encode is now bounded and diagnosable rather than a hung job. Guessing
    // "broken" here would ground a working setup.
    mockFfmpeg({ muxerError: new Error('spawnSync ffmpeg EACCES') });

    expect(() => assertFfmpegCapable('ffmpeg', 'mp4')).not.toThrow();
  });
});

describe("applyRecordingFraming", () => {
  beforeEach(() => vi.clearAllMocks());

  it("injects the framing stylesheet when hideSidebar is true", async () => {
    const page = { addStyleTag: vi.fn() };

    await applyRecordingFraming(page, { ...baseRecord, hideSidebar: true });

    expect(page.addStyleTag).toHaveBeenCalledWith({ content: FRAMING_CSS });
  });

  it("injects nothing when hideSidebar is false", async () => {
    const page = { addStyleTag: vi.fn() };

    await applyRecordingFraming(page, { ...baseRecord, hideSidebar: false });

    expect(page.addStyleTag).not.toHaveBeenCalled();
  });
});

describe("startRecording", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates the output directory and starts the screencast", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const recorder = { stop: vi.fn() };
    const page = { screencast: vi.fn().mockResolvedValue(recorder) };

    const result = await startRecording(page, baseRecord, '/abs/twd-artifacts/run.mp4');

    expect(fs.mkdirSync).toHaveBeenCalledWith('/abs/twd-artifacts', { recursive: true });
    expect(page.screencast).toHaveBeenCalledWith({
      path: '/abs/twd-artifacts/run.mp4',
      format: 'mp4',
      fps: 30,
      overwrite: true,
      ffmpegPath: 'ffmpeg',
    });
    expect(result).toBe(recorder);
  });

  it("forwards a custom ffmpegPath to the screencast", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const page = { screencast: vi.fn().mockResolvedValue({ stop: vi.fn() }) };

    await startRecording(
      page,
      { ...baseRecord, ffmpegPath: '/opt/homebrew/bin/ffmpeg' },
      '/abs/out.mp4'
    );

    // Puppeteer spawns its own ffmpeg, so the probe honoring this path is not
    // enough: the value has to reach page.screencast() or the encode ENOENTs.
    expect(page.screencast).toHaveBeenCalledWith(
      expect.objectContaining({ ffmpegPath: '/opt/homebrew/bin/ffmpeg' })
    );
  });

  it("does not create the directory when it already exists", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const page = { screencast: vi.fn().mockResolvedValue({ stop: vi.fn() }) };

    await startRecording(page, baseRecord, '/abs/twd-artifacts/run.mp4');

    expect(fs.mkdirSync).not.toHaveBeenCalled();
  });

  it("passes speed only when it is not 1, to avoid a no-op ffmpeg filter", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const page = { screencast: vi.fn().mockResolvedValue({ stop: vi.fn() }) };

    await startRecording(page, { ...baseRecord, speed: 0.5 }, '/abs/out.mp4');

    expect(page.screencast).toHaveBeenCalledWith(
      expect.objectContaining({ speed: 0.5 })
    );
  });
});

describe("holdOpeningFrame", () => {
  it("waits for the given duration", async () => {
    const started = Date.now();
    await holdOpeningFrame(60);
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
  });

  it("returns immediately for 0, undefined or a negative duration", async () => {
    const started = Date.now();
    await holdOpeningFrame(0);
    await holdOpeningFrame(undefined);
    await holdOpeningFrame(-100);
    expect(Date.now() - started).toBeLessThan(30);
  });
});

describe("holdFinalFrame", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs the repaint loop in the page for the given duration", async () => {
    const page = { evaluate: vi.fn() };

    await holdFinalFrame(page, 500);

    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), 500);
  });

  it("does nothing when the duration is 0, undefined or negative", async () => {
    const page = { evaluate: vi.fn() };

    await holdFinalFrame(page, 0);
    await holdFinalFrame(page, undefined);
    await holdFinalFrame(page, -100);

    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it("toggles a full-viewport overlay and always removes it", async () => {
    // Capture the page-side function and run it against a stub DOM, so the veil
    // lifecycle is verified rather than just the fact that evaluate was called.
    let pageFn;
    const page = { evaluate: vi.fn((fn) => { pageFn = fn; }) };
    await holdFinalFrame(page, 120);

    const backgrounds = [];
    const veil = {
      style: {
        cssText: '',
        set background(value) { backgrounds.push(value); },
        get background() { return backgrounds[backgrounds.length - 1] ?? ''; },
      },
      remove: vi.fn(),
    };
    const appended = [];
    const originalDocument = global.document;
    global.document = {
      createElement: () => veil,
      body: { appendChild: (node) => appended.push(node) },
    };

    try {
      await pageFn(120);
    } finally {
      global.document = originalDocument;
    }

    expect(appended).toEqual([veil]);
    // Must cover the whole viewport: a small element gets its own composited
    // layer and produces no screencast frame at all.
    expect(veil.style.cssText).toContain('position:fixed');
    expect(veil.style.cssText).toContain('inset:0');
    expect(veil.style.cssText).toContain('pointer-events:none');
    // Alternating alpha is what forces the repaints.
    expect(backgrounds).toContain('rgba(255,255,255,0.004)');
    expect(backgrounds).toContain('rgba(255,255,255,0)');
    expect(veil.remove).toHaveBeenCalled();
  });

  it("removes the overlay even when the repaint loop throws", async () => {
    let pageFn;
    const page = { evaluate: vi.fn((fn) => { pageFn = fn; }) };
    await holdFinalFrame(page, 120);

    const veil = {
      style: {
        cssText: '',
        set background(_value) { throw new Error('detached'); },
      },
      remove: vi.fn(),
    };
    const originalDocument = global.document;
    global.document = {
      createElement: () => veil,
      body: { appendChild: () => {} },
    };

    try {
      await expect(pageFn(120)).rejects.toThrow('detached');
    } finally {
      global.document = originalDocument;
    }

    expect(veil.remove).toHaveBeenCalled();
  });
});


// Production hands us a PassThrough, so the stand-in has to be a real emitter:
// the stream ending early is the only signal that ffmpeg died.
function createMockRecorder(stop) {
  const recorder = new EventEmitter();
  recorder.stop = stop ?? vi.fn().mockResolvedValue(undefined);
  return recorder;
}

describe("createFfmpegLog", () => {
  it("collects what puppeteer writes to the ffmpeg channel", () => {
    const { logger, lines } = createFfmpegLog();

    logger('puppeteer:ffmpeg')('[mov,mp4 muxer] Unable to parse option value "hybrid_fragmented"');

    expect(lines).toEqual(['[mov,mp4 muxer] Unable to parse option value "hybrid_fragmented"']);
  });

  it("hands every other channel to the fallback logger", () => {
    // puppeteer.launch does `options.logger ??= debug`, so supplying one
    // replaces the default outright. Without delegation, passing this would
    // silently switch off NODE_DEBUG=puppeteer:* for everything else.
    const fallback = vi.fn().mockReturnValue('fallback-writer');
    const { logger } = createFfmpegLog({ fallback });

    expect(logger('puppeteer:protocol:SEND ►')).toBe('fallback-writer');
    expect(fallback).toHaveBeenCalledWith('puppeteer:protocol:SEND ►');
  });

  it("keeps only the last lines, so a spamming encoder cannot grow it without bound", () => {
    const { logger, lines } = createFfmpegLog({ limit: 3 });
    const write = logger('puppeteer:ffmpeg');

    for (let i = 0; i < 10; i += 1) write(`line ${i}`);

    expect(lines).toEqual(['line 7', 'line 8', 'line 9']);
  });

  it("ignores blank output", () => {
    const { logger, lines } = createFfmpegLog();

    logger('puppeteer:ffmpeg')('   \n');

    expect(lines).toEqual([]);
  });
});

describe("watchRecorder", () => {
  it("reports a healthy recorder as alive", () => {
    const health = watchRecorder(createMockRecorder());

    expect(health.encoderDied).toBe(false);
  });

  it("marks the encoder dead when the stream ends before we asked it to stop", () => {
    const recorder = createMockRecorder();
    const health = watchRecorder(recorder);

    recorder.emit('end');

    expect(health.encoderDied).toBe(true);
  });

  it("aborts the frame pipeline as soon as the encoder dies", () => {
    // This is what stops the endless `ffmpeg failed to write` output: puppeteer
    // keeps pushing frames into a destroyed stdin until its pipeline is aborted,
    // and stop() is the only thing that aborts it.
    const recorder = createMockRecorder();
    watchRecorder(recorder);

    recorder.emit('close');

    expect(recorder.stop).toHaveBeenCalledTimes(1);
  });

  it("reacts only once when both end and close arrive", () => {
    const recorder = createMockRecorder();
    watchRecorder(recorder);

    recorder.emit('end');
    recorder.emit('close');

    expect(recorder.stop).toHaveBeenCalledTimes(1);
  });

  it("survives a stop that rejects while aborting", async () => {
    const recorder = createMockRecorder(vi.fn().mockRejectedValue(new Error('already gone')));
    const health = watchRecorder(recorder);

    recorder.emit('end');
    await new Promise((resolve) => setImmediate(resolve));

    expect(health.encoderDied).toBe(true);
  });
});

describe("stopRecording", () => {
  it("awaits a healthy recorder and reports success", async () => {
    const recorder = createMockRecorder();
    const health = watchRecorder(recorder);

    await expect(stopRecording(recorder, health)).resolves.toEqual({ ok: true });
    expect(recorder.stop).toHaveBeenCalledTimes(1);
  });

  it("does not await stop() once the encoder has died", async () => {
    // The hang, exactly. puppeteer's stop() ends on
    // `await new Promise(r => this.#process.once('close', r))`, and when ffmpeg
    // already exited that event fired long ago, so the listener never resolves.
    // Awaiting it costs the whole CI job.
    const recorder = createMockRecorder(vi.fn(() => new Promise(() => {})));
    const health = watchRecorder(recorder);
    recorder.emit('end');

    const result = await stopRecording(recorder, health);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/ffmpeg/i);
  });

  it("gives up on a stop that hangs without a detected death", async () => {
    const recorder = createMockRecorder(vi.fn(() => new Promise(() => {})));

    const result = await stopRecording(recorder, watchRecorder(recorder), 20);

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/20ms/);
  });

  it("reports a stop that rejects", async () => {
    const recorder = createMockRecorder(vi.fn().mockRejectedValue(new Error('pipe closed')));

    const result = await stopRecording(recorder, watchRecorder(recorder));

    expect(result).toEqual({ ok: false, reason: 'pipe closed' });
  });

  it("stops watching before stopping, so a normal shutdown is not read as a death", async () => {
    // A healthy stop() ends the stream too. Left attached, the watcher would
    // fire on that and call stop() a second time.
    const recorder = createMockRecorder(vi.fn(async () => { recorder.emit('end'); }));
    const health = watchRecorder(recorder);

    const result = await stopRecording(recorder, health);

    expect(result).toEqual({ ok: true });
    expect(recorder.stop).toHaveBeenCalledTimes(1);
  });
});


describe("transcodeForPlayback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("re-encodes to H.264 yuv420p and replaces the original in place", () => {
    // The screencast output is VP9 with pix_fmt=gbrp in an mp4 container: valid,
    // decodable, and openable in neither QuickTime nor Preview. A demo artifact
    // whose whole point is that a non-developer watches it cannot need VLC.
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '', stderr: '' });

    const result = transcodeForPlayback('ffmpeg', '/abs/twd-artifacts/run.mp4');

    expect(result).toEqual({ ok: true });
    const [bin, args] = vi.mocked(spawnSync).mock.calls[0];
    expect(bin).toBe('ffmpeg');
    expect(args).toEqual(expect.arrayContaining([
      '-i', '/abs/twd-artifacts/run.mp4',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
    ]));
    expect(fs.renameSync).toHaveBeenCalledWith(
      '/abs/twd-artifacts/.run.h264.mp4',
      '/abs/twd-artifacts/run.mp4'
    );
  });

  it("writes to a temp file that keeps the container extension", () => {
    // ffmpeg picks the muxer from the output extension, so a bare `.tmp` here
    // would fail with "Unable to find a suitable output format".
    vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: '', stderr: '' });

    transcodeForPlayback('ffmpeg', '/abs/out/run.mp4');

    expect(vi.mocked(spawnSync).mock.calls[0][1].at(-1)).toMatch(/\.mp4$/);
  });

  it("keeps the original and reports why when the encoder is unavailable", () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 1,
      stdout: '',
      stderr: "Unknown encoder 'libx264'\n",
    });

    const result = transcodeForPlayback('ffmpeg', '/abs/run.mp4');

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/libx264/);
    expect(fs.renameSync).not.toHaveBeenCalled();
  });

  it("clears the temp file it left behind on failure", () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 1, stdout: '', stderr: 'boom' });
    vi.mocked(fs.existsSync).mockReturnValue(true);

    transcodeForPlayback('ffmpeg', '/abs/run.mp4');

    expect(fs.unlinkSync).toHaveBeenCalledWith('/abs/.run.h264.mp4');
  });

  it("reports a binary that could not be spawned at all", () => {
    vi.mocked(spawnSync).mockReturnValue({ error: new Error('spawnSync ffmpeg ENOENT') });

    const result = transcodeForPlayback('ffmpeg', '/abs/run.mp4');

    expect(result).toEqual({ ok: false, reason: 'spawnSync ffmpeg ENOENT' });
  });
});
