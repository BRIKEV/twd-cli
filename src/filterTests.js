import { buildTestPath } from './buildTestPath.js';

export function selectTestIds(handlers, filters) {
  const needles = filters.map((f) => f.toLowerCase());
  const matchedNeedles = new Set();
  const ids = [];

  for (const handler of handlers) {
    if (handler.type !== 'test') continue;
    const path = buildTestPath(handler.id, handlers);
    if (!path) continue;
    const haystack = path.toLowerCase();

    let matched = false;
    for (let i = 0; i < needles.length; i++) {
      if (haystack.includes(needles[i])) {
        matched = true;
        matchedNeedles.add(i);
      }
    }
    if (matched) ids.push(handler.id);
  }

  const unmatchedFilters = filters.filter((_, i) => !matchedNeedles.has(i));
  return { ids, unmatchedFilters };
}
