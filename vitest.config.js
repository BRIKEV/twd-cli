import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.js'],
      exclude: [
        'node_modules/**',
        'tests/**',
        'coverage/**',
        'bin/**',
        '**/*.test.js',
        '**/*.spec.js',
      ],
      all: true,
    },
  },
});
