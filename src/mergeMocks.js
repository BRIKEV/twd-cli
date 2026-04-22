// Merge per-worker mock maps into a single map.
// Key scheme: `w${workerIndex}:${originalKey}` — worker-index prefix is
// defense-in-depth against random-ID collisions across contexts.
// Each output mock gets a workerIndex field so downstream enrichment
// (buildTestPath) can pick the correct worker's handler tree.
export function mergeMocks(workerMaps) {
  const merged = new Map();
  workerMaps.forEach((workerMap, workerIndex) => {
    for (const [key, mock] of workerMap) {
      merged.set(`w${workerIndex}:${key}`, { ...mock, workerIndex });
    }
  });
  return merged;
}
