import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/index.ts', 'src/**/types.ts', 'src/style.ts'],
      reporter: ['text', 'json-summary', 'html', 'lcov'],
      reportOnFailure: true,
      thresholds: {
        statements: 58,
        branches: 50,
        functions: 56,
        lines: 63,
      },
    },
  },
});
