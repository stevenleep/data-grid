import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = resolve(scriptsDirectory, '..');
const fixtureDirectory = join(scriptsDirectory, 'fixtures', 'package-consumer');
const rootPackage = JSON.parse(readFileSync(join(repositoryDirectory, 'package.json'), 'utf8'));

function readArgument(name) {
  const inlineArgument = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  const index = process.argv.indexOf(`--${name}`);
  return (
    inlineArgument?.slice(name.length + 3) ?? (index >= 0 ? process.argv[index + 1] : undefined)
  );
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function installedVersion(packageName, baseDirectory = repositoryDirectory) {
  const packagePath = join(
    baseDirectory,
    'node_modules',
    ...packageName.split('/'),
    'package.json',
  );
  return JSON.parse(readFileSync(packagePath, 'utf8')).version;
}

const currentVersions = {
  icons: installedVersion('@ant-design/icons'),
  antd: installedVersion('antd'),
  react: installedVersion('react'),
  reactDom: installedVersion('react-dom'),
  reactTypes: installedVersion('@types/react'),
  reactDomTypes: installedVersion('@types/react-dom'),
  typescript: installedVersion('typescript'),
  vite: installedVersion('vite', join(repositoryDirectory, 'examples', 'demo')),
};

const profiles = {
  'core-only': {
    kind: 'core',
    label: 'Core only without UI peers',
    typescript: currentVersions.typescript,
  },
  'react18-min': {
    kind: 'ui',
    label: 'React 18 / Ant Design 6 / TypeScript 5.4 lower boundary',
    react: '18.0.0',
    reactDom: '18.0.0',
    reactTypes: '^18.3.0',
    reactDomTypes: '^18.3.0',
    antd: '6.0.0',
    icons: '6.0.0',
    typescript: '5.4.5',
  },
  'react18-current': {
    kind: 'ui',
    label: 'React 18 current / current Ant Design 6',
    react: '18.3.1',
    reactDom: '18.3.1',
    reactTypes: '^18.3.0',
    reactDomTypes: '^18.3.0',
    antd: currentVersions.antd,
    icons: currentVersions.icons,
    typescript: currentVersions.typescript,
  },
  'react19-min': {
    kind: 'ui',
    label: 'React 19 / Ant Design 6 / TypeScript 5.4 lower boundary',
    react: '19.0.0',
    reactDom: '19.0.0',
    reactTypes: currentVersions.reactTypes,
    reactDomTypes: currentVersions.reactDomTypes,
    antd: '6.0.0',
    icons: '6.0.0',
    typescript: '5.4.5',
  },
  'react19-current': {
    kind: 'ui',
    label: 'React 19 / Ant Design 6 / TypeScript 7 / Vite current',
    react: currentVersions.react,
    reactDom: currentVersions.reactDom,
    reactTypes: currentVersions.reactTypes,
    reactDomTypes: currentVersions.reactDomTypes,
    antd: currentVersions.antd,
    icons: currentVersions.icons,
    typescript: '7.0.2',
  },
};

function readProfile() {
  const requestedProfile = readArgument('profile');
  const legacyReact = readArgument('react');
  const profileName =
    requestedProfile ??
    (legacyReact === '18'
      ? 'react18-current'
      : legacyReact === '19' || legacyReact === undefined
        ? 'react19-current'
        : undefined);

  if (!profileName || !(profileName in profiles)) {
    throw new Error(
      `Unknown consumer profile: ${String(profileName)}. Expected one of ${Object.keys(profiles).join(', ')}.`,
    );
  }

  return { name: profileName, ...profiles[profileName] };
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

function listFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

const profile = readProfile();
const withVite = profile.kind === 'ui' && hasFlag('with-vite');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'huiyun-data-grid-package-'));
const consumerDirectory = join(temporaryDirectory, 'consumer');
const tarballPath = join(temporaryDirectory, 'huiyun-data-grid.tgz');

try {
  run('pnpm', ['pack', '--out', tarballPath], repositoryDirectory);

  mkdirSync(consumerDirectory, { recursive: true });
  cpSync(fixtureDirectory, consumerDirectory, { recursive: true });

  const dependencies = {
    '@huiyun/data-grid': `file:${tarballPath}`,
  };
  const devDependencies = {
    typescript: profile.typescript,
  };

  if (profile.kind === 'ui') {
    Object.assign(dependencies, {
      '@ant-design/icons': profile.icons,
      antd: profile.antd,
      react: profile.react,
      'react-dom': profile.reactDom,
    });
    Object.assign(devDependencies, {
      '@types/react': profile.reactTypes,
      '@types/react-dom': profile.reactDomTypes,
      ...(withVite ? { vite: currentVersions.vite } : {}),
    });
  }

  writeFileSync(
    join(consumerDirectory, 'package.json'),
    `${JSON.stringify(
      {
        name: `@huiyun/data-grid-consumer-${profile.name}`,
        private: true,
        type: 'module',
        packageManager: rootPackage.packageManager,
        dependencies,
        devDependencies,
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

  for (const unexpectedStyleArtifact of [
    'dist/style.mjs',
    'dist/style.cjs',
    'dist/style.d.mts',
    'dist/style.d.cts',
  ]) {
    assert.equal(
      existsSync(join(installedPackage, unexpectedStyleArtifact)),
      false,
      `${unexpectedStyleArtifact} should not be published`,
    );
  }

  const stylesheet = readFileSync(join(installedPackage, 'dist', 'style.css'), 'utf8');
  assert.match(stylesheet, /\.hui-grid/);

  if (profile.kind === 'core') {
    for (const uiPeer of ['react', 'react-dom', 'antd', join('@ant-design', 'icons')]) {
      assert.equal(
        existsSync(join(consumerDirectory, 'node_modules', uiPeer)),
        false,
        `${uiPeer} was unexpectedly installed by the core-only profile`,
      );
    }

    run('node', ['core-esm.mjs'], consumerDirectory);
    run('node', ['core-cjs.cjs'], consumerDirectory);
    run('pnpm', ['exec', 'tsc', '--project', 'tsconfig.core.json'], consumerDirectory);
  } else {
    const reactMajor = profile.react.split('.')[0];
    run('node', ['esm.mjs', reactMajor], consumerDirectory);
    run('node', ['cjs.cjs'], consumerDirectory);
    run('pnpm', ['exec', 'tsc', '--project', 'tsconfig.bundler.json'], consumerDirectory);
    run('pnpm', ['exec', 'tsc', '--project', 'tsconfig.nodenext.json'], consumerDirectory);

    if (withVite) {
      run('pnpm', ['exec', 'vite', 'build', '--outDir', 'vite-dist'], consumerDirectory);
      const viteFiles = listFiles(join(consumerDirectory, 'vite-dist'));
      assert.ok(
        viteFiles.some((file) => file.endsWith('.js')),
        'Vite emitted no JavaScript',
      );
      assert.ok(
        viteFiles.some((file) => file.endsWith('.css')),
        'Vite emitted no CSS',
      );
    }
  }

  process.stdout.write(`Package consumer smoke test passed: ${profile.label}.\n`);
} finally {
  if (process.env.KEEP_PACKAGE_SMOKE !== '1') {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  } else {
    process.stdout.write(`Package smoke-test files kept at ${temporaryDirectory}.\n`);
  }
}
