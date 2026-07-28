export function parseRunArgs(argv) {
  const testFilters = [];
  const record = {};

  const readValue = (token, prefix, index) => {
    if (token === prefix) {
      return { value: argv[index + 1], consumed: argv[index + 1] !== undefined ? 2 : 1 };
    }
    return { value: token.slice(prefix.length + 1), consumed: 1 };
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (token === '--test' || token.startsWith('--test=')) {
      const { value, consumed } = readValue(token, '--test', i);
      if (value !== undefined) testFilters.push(value);
      i += consumed - 1;
    } else if (token === '--record') {
      record.enabled = true;
    } else if (token === '--record-dir' || token.startsWith('--record-dir=')) {
      const { value, consumed } = readValue(token, '--record-dir', i);
      if (value !== undefined) record.dir = value;
      i += consumed - 1;
    } else if (token === '--record-speed' || token.startsWith('--record-speed=')) {
      const { value, consumed } = readValue(token, '--record-speed', i);
      const parsed = Number(value);
      if (value !== undefined && Number.isFinite(parsed) && parsed > 0) {
        record.speed = parsed;
      }
      i += consumed - 1;
    } else if (token === '--record-pace' || token.startsWith('--record-pace=')) {
      const { value, consumed } = readValue(token, '--record-pace', i);
      const parsed = Number(value);
      if (value !== undefined && Number.isFinite(parsed) && parsed > 0) {
        record.pace = parsed;
      }
      i += consumed - 1;
    }
  }

  return { testFilters, record };
}
