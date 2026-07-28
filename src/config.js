import fs from 'fs';
import path from 'path';

export const DEFAULT_RECORD = {
  enabled: false,
  dir: './twd-artifacts',
  filename: null,
  format: 'mp4',
  // deviceScaleFactor stays at 1 on purpose. Puppeteer measures the recording
  // dimensions with deviceScaleFactor forced to 0, so a higher factor never
  // reaches the video, but it is live on the page during the run (srcset picks
  // 2x assets, dpr-branching code takes another path). All cost, no benefit.
  viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
  fps: 30,
  speed: 1,
  // Milliseconds twd-js holds after each command, driven through
  // window.__twdSetPace. Unlike `speed`, this slows the run itself rather than
  // stretching the video, so it does not cost frame rate.
  //
  // On by default, because an unpaced recording is roughly a second long and
  // nobody can watch it. 300 rather than 500: still clearly watchable, and it
  // costs about 40% less wall clock on a broad run. Set 0 to disable.
  pace: 300,
  // A beat on the opening state before the first test runs. Cosmetic, off by
  // default.
  preRoll: 0,
  // Not cosmetic. Chrome never captures the last thing a test did unless
  // something repaints afterwards, so without this the video ends one or two
  // states early. See holdFinalFrame in src/recorder.js. 0 disables it.
  postRoll: 500,
  hideSidebar: true,
  ffmpegPath: 'ffmpeg',
};

const DEFAULT_CONFIG = {
  url: 'http://localhost:5173',
  timeout: 10000,
  coverage: true,
  coverageDir: './coverage',
  nycOutputDir: './.nyc_output',
  headless: true,
  puppeteerArgs: ['--no-sandbox', '--disable-setuid-sandbox'],
  retryCount: 2,
  protocolTimeout: 300000,
  maxFailures: 10,
  chunkSize: 10,
  record: DEFAULT_RECORD,
};

export function loadConfig() {
  const configPath = path.resolve(process.cwd(), 'twd.config.json');
  
  if (fs.existsSync(configPath)) {
    try {
      const configFile = fs.readFileSync(configPath, 'utf-8');
      const userConfig = JSON.parse(configFile);
      const userRecord = userConfig.record || {};
      return {
        ...DEFAULT_CONFIG,
        ...userConfig,
        record: {
          ...DEFAULT_RECORD,
          ...userRecord,
          viewport: { ...DEFAULT_RECORD.viewport, ...(userRecord.viewport || {}) },
        },
      };
    } catch (error) {
      console.warn('Warning: Could not parse twd.config.json, using defaults:', error.message);
      return DEFAULT_CONFIG;
    }
  }
  
  return DEFAULT_CONFIG;
}
