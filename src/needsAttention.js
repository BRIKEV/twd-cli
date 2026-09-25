function byRunOrder(a, b) {
  return (a.index ?? Infinity) - (b.index ?? Infinity);
}

function contractFields(result) {
  return {
    method: result.method,
    matchedPath: result.matchedPath,
    status: result.status,
    alias: result.alias,
    spec: result.specSource,
    testName: result.testName ?? null,
  };
}

// The one ordered list of what broke; both renderers show exactly this.
export function needsAttention(report) {
  const snapshots = [...(report.snapshots ?? [])];
  const failed = report.tests.filter((t) => t.status === 'fail').sort(byRunOrder);

  const items = failed.map((test) => {
    const at = snapshots.findIndex((s) => String(test.error ?? '').includes(s.name));
    const snapshot = at === -1 ? null : snapshots.splice(at, 1)[0];
    return {
      kind: 'test',
      path: test.path ?? test.id,
      error: test.error ?? null,
      attempts: test.attempts ?? 1,
      recording: test.recording ?? null,
      snapshot,
    };
  });

  for (const s of snapshots) items.push({ kind: 'snapshot', name: s.name, file: s.file });

  for (const result of report.contracts?.results ?? []) {
    if (result.mode !== 'error' || result.validation?.valid !== false) continue;
    items.push({ kind: 'contract', ...contractFields(result), errors: result.validation.errors });
  }

  return items;
}

export function contractWarnings(report) {
  const warnings = [];
  for (const result of report.contracts?.results ?? []) {
    const validation = result.validation;
    if (!validation) continue;
    const messages = [];
    if (!validation.valid && result.mode !== 'error') {
      for (const err of validation.errors) messages.push(`${err.path}: ${err.message}`);
    }
    for (const w of validation.warnings ?? []) messages.push(w.message);
    if (messages.length) warnings.push({ ...contractFields(result), messages });
  }
  return warnings;
}
