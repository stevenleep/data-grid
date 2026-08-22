import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    core: 'src/core/index.ts',
    react: 'src/react/index.ts',
    antd: 'src/antd/index.ts',
    style: 'src/style.ts',
  },
  target: 'es2020',
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  deps: {
    neverBundle: ['react', 'react-dom', 'antd', '@ant-design/icons', 'dayjs'],
  },
});
