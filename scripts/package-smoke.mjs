import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = resolve(scriptsDirectory, '..');
const fixtureDirectory = join(scriptsDirectory, 'fixtures', 'package-consumer');
const rootPackage = JSON.parse(readFileSync(join(repositoryDirectory, 'package.json'), 'utf8'));

function readReactMajor() {
  const inlineArgument = process.argv.find((argument) => argument.startsWith('--react='));
  const index = process.argv.indexOf('--react');
  const value =
    inlineArgument?.slice('--react='.length) ?? (index >= 0 ? process.argv[index + 1] : '19');

  if (value !== '18' && value !== '19') {
    throw new Error(`Unsupported React smoke-test major: ${String(value)}. Expected 18 or 19.`);
  }

  return value;
}

function run(command, arguments_, cwd) {
  const result = spawnSync(command, arguments_, {
    cwd,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${arguments_.join(' ')} failed with exit code ${result.status}.`);
  }
}

const reactMajor = readReactMajor();
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'huiyun-data-grid-package-'));
const consumerDirectory = join(temporaryDirectory, 'consumer');
const tarballPath = join(temporaryDirectory, 'huiyun-data-grid.tgz');

try {
  run('pnpm', ['pack', '--out', tarballPath], repositoryDirectory);

  mkdirSync(consumerDirectory, { recursive: true });
  cpSync(fixtureDirectory, consumerDirectory, { recursive: true });

  const reactDependencies =
    reactMajor === '18'
      ? {
          react: '18.3.1',
          'react-dom': '18.3.1',
          '@types/react': '^18.3.0',
          '@types/react-dom': '^18.3.0',
        }
      : {
          react: rootPackage.devDependencies.react,
          'react-dom': rootPackage.devDependencies['react-dom'],
          '@types/react': rootPackage.devDependencies['@types/react'],
          '@types/react-dom': rootPackage.devDependencies['@types/react-dom'],
        };

  writeFileSync(
    join(consumerDirectory, 'package.json'),
    `${JSON.stringify(
      {
        name: `@huiyun/data-grid-consumer-react-${reactMajor}`,
        private: true,
        type: 'module',
        packageManager: rootPackage.packageManager,
        dependencies: {
          '@huiyun/data-grid': `file:${tarballPath}`,
          '@ant-design/icons': rootPackage.devDependencies['@ant-design/icons'],
          antd: rootPackage.devDependencies.antd,
          react: reactDependencies.react,
          'react-dom': reactDependencies['react-dom'],
        },
        devDependencies: {
          '@types/react': reactDependencies['@types/react'],
          '@types/react-dom': reactDependencies['@types/react-dom'],
          typescript: rootPackage.devDependencies.typescript,
        },
      },
      null,
      2,
    )}\n`,
  );

  run(
    'pnpm',
    ['install', '--ignore-scripts', '--frozen-lockfile=false', '--config.auto-install-peers=false'],
    consumerDirectory,
  );

  const installedPackage = join(consumerDirectory, 'node_modules', '@huiyun', 'data-grid');
  const expectedFiles = [
    'dist/index.mjs',
    'dist/index.cjs',
    'dist/index.d.mts',
    'dist/index.d.cts',
    'dist/core.mjs',
    'dist/core.cjs',
    'dist/react.mjs',
    'dist/react.cjs',
    'dist/antd.mjs',
    'dist/antd.cjs',
    'dist/style.css',
    'style.d.ts',
  ];

  for (const relativePath of expectedFiles) {
    assert.ok(
      existsSync(join(installedPackage, relativePath)),
      `${relativePath} is missing from tarball`,
    );
  }

  const stylesheet = readFileSync(join(installedPackage, 'dist', 'style.css'), 'utf8');
  assert.match(stylesheet, /\.hui-grid/);

  run('node', ['esm.mjs', reactMajor], consumerDirectory);
  run('node', ['cjs.cjs'], consumerDirectory);
  run('pnpm', ['exec', 'tsc', '--project', 'tsconfig.bundler.json'], consumerDirectory);
  run('pnpm', ['exec', 'tsc', '--project', 'tsconfig.nodenext.json'], consumerDirectory);

  process.stdout.write(`Package consumer smoke test passed with React ${reactMajor}.\n`);
} finally {
  if (process.env.KEEP_PACKAGE_SMOKE !== '1') {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  } else {
    process.stdout.write(`Package smoke-test files kept at ${temporaryDirectory}.\n`);
  }
}
