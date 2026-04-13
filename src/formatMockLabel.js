function ordinal(n) {
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

export function formatMockLabel(result) {
  let label = `mock "${result.alias}"`;
  if (result.occurrence && result.occurrence > 1) {
    label += ` ${ordinal(result.occurrence)} time`;
  }
  if (result.testName) {
    label += ` — in "${result.testName}"`;
  }
  return label;
}
