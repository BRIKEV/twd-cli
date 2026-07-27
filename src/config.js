import fs from 'fs';
import path from 'path';

export const DEFAULT_RECORD = {
  enabled: false,
  dir: './twd-artifacts',
  filename: null,
  format: 'mp4',
  viewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
  fps: 30,
  speed: 1,
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
