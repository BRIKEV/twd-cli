// Validates a CPU throttling rate, for both --cpu-throttle and the cpuThrottle
// config key, so the two refuse the same values in the same words.
//
// It throws rather than falling back to full speed. A dropped rate is a run
// the caller believes was throttled, and "it passes under throttling" is the
// one conclusion this feature exists to make trustworthy. Puppeteer would
// refuse a rate below 1 too, but only after the launch, and in its own words.
export function parseCpuThrottle(value, source) {
  const rate = typeof value === 'string' ? Number(value) : value;
  if (typeof rate === 'number' && Number.isFinite(rate) && rate >= 1) return rate;

  const got = value === undefined ? 'nothing' : JSON.stringify(value);
  throw new Error(
    `Invalid ${source}: expected a rate of 1 or more, got ${got}. ` +
    "1 is full speed; 4 makes the browser's CPU four times slower."
  );
}
