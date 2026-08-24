import { defineConfig } from 'vitest/config';

const uiCoverageThresholds = {
  'src/antd/DataGrid.tsx': { statements: 95, branches: 85, functions: 90, lines: 95 },
  'src/antd/actions.tsx': { statements: 90, branches: 70, functions: 85, lines: 90 },
  'src/antd/cells.tsx': { statements: 60, branches: 50, functions: 70, lines: 65 },
  'src/antd/columns.tsx': { statements: 50, branches: 45, functions: 65, lines: 55 },
  'src/antd/context.tsx': { statements: 95, branches: 95, functions: 95, lines: 95 },
  'src/antd/filter.tsx': { statements: 50, branches: 40, functions: 40, lines: 50 },
  'src/antd/hooks.ts': { statements: 80, branches: 75, functions: 80, lines: 85 },
  'src/antd/intl.ts': { statements: 65, branches: 40, functions: 80, lines: 70 },
  'src/antd/layout.tsx': { statements: 80, branches: 65, functions: 70, lines: 80 },
  'src/antd/locale.ts': { statements: 60, branches: 35, functions: 50, lines: 60 },
  'src/antd/operators.ts': { statements: 95, branches: 70, functions: 95, lines: 95 },
  'src/antd/render.tsx': { statements: 70, branches: 80, functions: 75, lines: 75 },
  'src/antd/selection-mode.ts': { statements: 90, branches: 85, functions: 85, lines: 90 },
  'src/antd/sort.tsx': { statements: 50, branches: 50, functions: 45, lines: 55 },
  'src/antd/table.tsx': { statements: 75, branches: 65, functions: 85, lines: 80 },
  'src/antd/views.tsx': { statements: 45, branches: 70, functions: 20, lines: 45 },
} as const;

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
        statements: 70,
        branches: 63,
        functions: 75,
        lines: 74,
        ...uiCoverageThresholds,
      },
    },
  },
});
