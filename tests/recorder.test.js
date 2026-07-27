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
    });
    expect(result).toBe(recorder);
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
