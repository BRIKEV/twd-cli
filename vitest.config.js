import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      'node_modules/**',
      'coverage/**',
      'test-example-app/**',
    ],
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
        'test-example-app/**',
      ],
      all: true,
    },
  },
});
