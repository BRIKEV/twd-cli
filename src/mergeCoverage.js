import libCoverage from 'istanbul-lib-coverage';

/**
 * Combines per-shard Istanbul coverage into one map.
 *
 * This is the one artifact that needed no bespoke merge logic: summing hit
 * counts across runs of the same code is exactly what CoverageMap.merge does,
 * and it is the same operation `nyc merge` performs.
 *
 * Nulls are skipped rather than rejected — a shard that collected no coverage
 * (a filtered run, or one that never loaded instrumented code) reads back as
 * null and simply does not contribute.
 *
 * Inputs are cloned before merging. `istanbul-lib-coverage`'s `FileCoverage`
 * wraps a plain coverage object by reference instead of copying it, so the
 * first shard's raw object would otherwise become the map's live storage and
 * get mutated in place (`this.data.s = ...`) once a later shard's counts for
 * the same file are merged in.
 */
export function mergeCoverage(coverageObjects) {
  const map = libCoverage.createCoverageMap({});
  for (const coverage of coverageObjects) {
    if (coverage) map.merge(structuredClone(coverage));
  }
  return map.toJSON();
}
