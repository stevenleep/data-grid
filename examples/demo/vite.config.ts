import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 500,
    rolldownOptions: {
      output: {
        codeSplitting: {
          maxSize: 900_000,
          minSize: 10_000,
          groups: [
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 5,
            },
            {
              name: 'antd-icons',
              test: /node_modules[\\/]@ant-design[\\/]icons[\\/]/,
              priority: 4,
            },
            {
              name: 'antd-components',
              test: /node_modules[\\/]antd[\\/]/,
              priority: 3,
            },
            {
              name: 'antd-foundation',
              test: /node_modules[\\/](@ant-design|@rc-component|rc-[^\\/]+)[\\/]/,
              priority: 2,
            },
            {
              name: 'vendor',
              test: /node_modules[\\/]/,
              priority: 1,
            },
          ],
        },
      },
    },
  },
  resolve: {
    alias: [
      {
        find: '@stevenleep/data-grid/style.css',
        replacement: fileURLToPath(new URL('../../src/styles.css', import.meta.url)),
      },
      {
        find: '@stevenleep/data-grid',
        replacement: fileURLToPath(new URL('../../src/index.ts', import.meta.url)),
      },
    ],
  },
  server: {
    port: 5173,
  },
});
