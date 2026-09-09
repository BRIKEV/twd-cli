import fs from 'fs';
import path from 'path';

export const DEFAULT_RECORD = {
  enabled: false,
  dir: './twd-artifacts',
  filename: null,
  // A human bound, not a cost one: a clip costs ~250ms, but nobody opens 30 of
  // them. 0 disables it.
  maxClips: 20,
  format: 'mp4',
  // 1600 tall, not 720. The viewport decides what the video contains: puppeteer
  // captures exactly it, with no scrolling and no letterboxing, so anything
  // below the fold is simply absent. At 720 a recording of twd-vue-example cut
  // the todos page just below the filter buttons, which put the list the tests
  // assert on off-frame — a clip that looked fine and showed none of the
  // behaviour under test. Nothing in the run says the frame was cropped, so only
  // a human watching the video catches it. A taller default is wrong in the
  // other direction for apps that fit, but it wastes encoder time on empty
  // space, which is the cheaper mistake.
  //
  // Even numbers on both axes are not optional: the H.264 conversion in
  // recorder.js uses yuv420p, which requires them.
  //
  // deviceScaleFactor stays at 1 on purpose. Puppeteer measures the recording
  // dimensions with deviceScaleFactor forced to 0, so a higher factor never
  // reaches the video, but it is live on the page during the run (srcset picks
  // 2x assets, dpr-branching code takes another path). All cost, no benefit.
  viewport: { width: 1280, height: 1600, deviceScaleFactor: 1 },
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

// The viewport every run gets, snapshots or not. Layout snapshots are only
// reproducible if the size is fixed and explicit: relying on puppeteer's
// implicit default would mean a puppeteer upgrade could change it and
// invalidate every committed reference at once, silently.
//
// Deliberately NOT record.viewport, which is the video's dimensions and means
// something different. When recording, that one still wins.
export const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

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
  viewport: DEFAULT_VIEWPORT,
  // Must match the `dir` given to the twdSnapshot vite plugin. Two processes
  // that never talk to each other, so this duplication cannot be designed away.
  snapshotDir: '__twd_snapshots__',
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
        // Two levels, like record.viewport below: a flat spread would let
        // `{ "viewport": { "width": 375 } }` drop the height and hand puppeteer
        // an undefined.
        viewport: { ...DEFAULT_VIEWPORT, ...(userConfig.viewport || {}) },
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
