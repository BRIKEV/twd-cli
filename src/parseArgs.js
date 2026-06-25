export function parseRunArgs(argv) {
  const testFilters = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--test') {
      const value = argv[i + 1];
      if (value !== undefined) {
        testFilters.push(value);
        i++;
      }
    } else if (token.startsWith('--test=')) {
      testFilters.push(token.slice('--test='.length));
    }
  }

  return { testFilters };
}
