import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
vi.mock('fs');

import { spawnSync } from 'node:child_process';
import fs from 'fs';
import {
  FRAMING_CSS,
  assertFfmpegAvailable,
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

describe("assertFfmpegAvailable", () => {
  beforeEach(() => vi.clearAllMocks());

  it("probes with -version and returns when the binary runs", () => {
    vi.mocked(spawnSync).mockReturnValue({ error: undefined });

    expect(() => assertFfmpegAvailable('ffmpeg')).not.toThrow();
    expect(spawnSync).toHaveBeenCalledWith('ffmpeg', ['-version']);
  });

  it("throws with install instructions when the binary is missing", () => {
    vi.mocked(spawnSync).mockReturnValue({ error: new Error('spawnSync ffmpeg ENOENT') });

    expect(() => assertFfmpegAvailable('ffmpeg')).toThrow(/ffmpeg/);
    expect(() => assertFfmpegAvailable('ffmpeg')).toThrow(/brew install ffmpeg/);
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
