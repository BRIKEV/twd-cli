import { describe, it, expect } from "vitest";
import { parseCpuThrottle } from "../src/cpuThrottle.js";

describe("parseCpuThrottle", () => {
  it("reads a flag's string value as a number", () => {
    expect(parseCpuThrottle('4', '--cpu-throttle')).toBe(4);
    expect(parseCpuThrottle('2.5', '--cpu-throttle')).toBe(2.5);
  });

  it("takes a config number as it is", () => {
    expect(parseCpuThrottle(6, '"cpuThrottle" in twd.config.json')).toBe(6);
  });

  it("accepts 1, which is full speed", () => {
    expect(parseCpuThrottle('1', '--cpu-throttle')).toBe(1);
    expect(parseCpuThrottle(1, '"cpuThrottle" in twd.config.json')).toBe(1);
  });

  it.each(['0', '0.5', '-1', 0, 0.9])("refuses %j, which puppeteer would reject after the launch", (value) => {
    expect(() => parseCpuThrottle(value, '--cpu-throttle')).toThrow(
      /Invalid --cpu-throttle: expected a rate of 1 or more/
    );
  });

  it.each(['abc', '', 'Infinity', true, null])("refuses the non-number %j", (value) => {
    expect(() => parseCpuThrottle(value, '--cpu-throttle')).toThrow(/Invalid --cpu-throttle/);
  });

  it("says a flag given no value got nothing", () => {
    expect(() => parseCpuThrottle(undefined, '--cpu-throttle')).toThrow(/got nothing/);
  });

  it("names where the value came from, and what a valid one does", () => {
    expect(() => parseCpuThrottle(0, '"cpuThrottle" in twd.config.json')).toThrow(
      'Invalid "cpuThrottle" in twd.config.json: expected a rate of 1 or more, got 0. ' +
      "1 is full speed; 4 makes the browser's CPU four times slower."
    );
  });
});
