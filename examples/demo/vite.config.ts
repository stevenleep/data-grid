import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@huiyun/data-grid/style.css',
        replacement: fileURLToPath(new URL('../../src/styles.css', import.meta.url)),
      },
      {
        find: '@huiyun/data-grid',
        replacement: fileURLToPath(new URL('../../src/index.ts', import.meta.url)),
      },
    ],
  },
  server: {
    port: 5173,
  },
});
