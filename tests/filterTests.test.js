import { describe, it, expect } from "vitest";
import { selectTestIds } from "../src/filterTests.js";

const handlers = [
  { id: 's1', name: 'Login', parent: undefined, type: 'suite' },
  { id: 't1', name: 'shows error on bad password', parent: 's1', type: 'test' },
  { id: 't2', name: 'redirects on success', parent: 's1', type: 'test' },
  { id: 's2', name: 'Signup', parent: undefined, type: 'suite' },
  { id: 't3', name: 'shows error on taken email', parent: 's2', type: 'test' },
];

describe("selectTestIds", () => {
  it("matches a leaf test name by case-insensitive substring", () => {
    const { ids, unmatchedFilters } = selectTestIds(handlers, ['REDIRECTS']);
    expect(ids).toEqual(['t2']);
    expect(unmatchedFilters).toEqual([]);
  });

  it("matches all tests under a describe via the full path", () => {
    const { ids } = selectTestIds(handlers, ['Login']);
    expect(ids.sort()).toEqual(['t1', 't2']);
  });

  it("treats multiple filters as OR", () => {
    const { ids } = selectTestIds(handlers, ['redirects', 'taken email']);
    expect(ids.sort()).toEqual(['t2', 't3']);
  });

  it("matches the same substring across suites", () => {
    const { ids } = selectTestIds(handlers, ['shows error']);
    expect(ids.sort()).toEqual(['t1', 't3']);
  });

  it("reports filters that matched nothing", () => {
    const { ids, unmatchedFilters } = selectTestIds(handlers, ['Login', 'nope']);
    expect(ids.sort()).toEqual(['t1', 't2']);
    expect(unmatchedFilters).toEqual(['nope']);
  });

  it("returns empty ids when nothing matches", () => {
    const { ids, unmatchedFilters } = selectTestIds(handlers, ['zzz']);
    expect(ids).toEqual([]);
    expect(unmatchedFilters).toEqual(['zzz']);
  });

  it("ignores suite handlers as run targets", () => {
    const { ids } = selectTestIds(handlers, ['Signup']);
    expect(ids).toEqual(['t3']); // s2 (the suite) is never an id
  });
});
