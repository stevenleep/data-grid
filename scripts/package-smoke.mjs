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
  nodeTypes: installedVersion('@types/node'),
  antd: installedVersion('antd'),
  react: installedVersion('react'),
  reactDom: installedVersion('react-dom'),
  reactTypes: installedVersion('@types/react'),
  reactDomTypes: installedVersion('@types/react-dom'),
  jsdom: installedVersion('jsdom'),
  playwright: installedVersion('playwright'),
  typescript: installedVersion('typescript'),
  typescriptCurrent: installedVersion('typescript-current'),
  vite: installedVersion('vite', join(repositoryDirectory, 'examples', 'demo')),
};

const profiles = {
  'core-min': {
    kind: 'core',
    label: 'Core only / TypeScript 5.4 lower boundary / no DOM lib or UI peers',
    nodeTypes: '20.11.30',
    typescript: '5.4.5',
  },
  'core-current': {
    kind: 'core',
    label: 'Core only / current repository TypeScript / no DOM lib or UI peers',
    nodeTypes: currentVersions.nodeTypes,
    typescript: currentVersions.typescript,
  },
  'react18-min': {
    kind: 'ui',
    label: 'React 18 / Ant Design 6 / TypeScript 5.4 lower boundary',
    react: '18.0.0',
    reactDom: '18.0.0',
    // Earliest React 18 type packages that export the automatic JSX runtime
    // and react-dom/client under NodeNext resolution.
    reactTypes: '18.0.8',
    reactDomTypes: '18.0.2',
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
    reactTypes: '19.0.0',
    reactDomTypes: '19.0.0',
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
    typescript: currentVersions.typescriptCurrent,
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
const withBrowser = profile.kind === 'ui' && hasFlag('with-browser');
const manager = readArgument('manager') ?? 'pnpm';
if (!['npm', 'pnpm'].includes(manager)) {
  throw new Error(`Unknown package manager: ${manager}. Expected npm or pnpm.`);
}
if (withBrowser && !withVite) {
  throw new Error('--with-browser requires --with-vite.');
}
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
    ...(profile.kind === 'core' ? { '@types/node': profile.nodeTypes } : {}),
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
      jsdom: currentVersions.jsdom,
      ...(withVite ? { vite: currentVersions.vite } : {}),
      ...(withBrowser ? { playwright: currentVersions.playwright } : {}),
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

  if (manager === 'pnpm') {
    run(
      'pnpm',
      [
        'install',
        '--ignore-scripts',
        '--frozen-lockfile=false',
        '--config.auto-install-peers=false',
      ],
      consumerDirectory,
    );
  } else {
    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumerDirectory);
  }

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

  for (const clientEntry of ['index', 'react', 'antd']) {
    for (const extension of ['mjs', 'cjs']) {
      const contents = readFileSync(
        join(installedPackage, 'dist', `${clientEntry}.${extension}`),
        'utf8',
      );
      assert.match(
        contents,
        /^['"]use client['"];/,
        `${clientEntry}.${extension} must preserve the React Server Components client boundary`,
      );
    }
  }
  for (const extension of ['mjs', 'cjs']) {
    const coreContents = readFileSync(join(installedPackage, 'dist', `core.${extension}`), 'utf8');
    assert.doesNotMatch(
      coreContents,
      /^['"]use client['"];/,
      `core.${extension} must remain server-safe`,
    );
  }

  const binary = (name) =>
    join(
      consumerDirectory,
      'node_modules',
      '.bin',
      `${name}${process.platform === 'win32' ? '.cmd' : ''}`,
    );

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
    run(binary('tsc'), ['--project', 'tsconfig.core.json'], consumerDirectory);
  } else {
    const reactMajor = profile.react.split('.')[0];
    run('node', ['esm.mjs', reactMajor], consumerDirectory);
    run('node', ['cjs.cjs'], consumerDirectory);
    run('node', ['client.mjs'], consumerDirectory);
    run(binary('tsc'), ['--project', 'tsconfig.bundler.json'], consumerDirectory);
    run(binary('tsc'), ['--project', 'tsconfig.nodenext.json'], consumerDirectory);

    if (withVite) {
      run(binary('vite'), ['build', '--outDir', 'vite-dist'], consumerDirectory);
      const viteFiles = listFiles(join(consumerDirectory, 'vite-dist'));
      assert.ok(
        viteFiles.some((file) => file.endsWith('.js')),
        'Vite emitted no JavaScript',
      );
      assert.ok(
        viteFiles.some((file) => file.endsWith('.css')),
        'Vite emitted no CSS',
      );
      if (withBrowser) run('node', ['browser-smoke.mjs'], consumerDirectory);
    }
  }

  process.stdout.write(`Package consumer smoke test passed: ${profile.label} via ${manager}.\n`);
} finally {
  if (process.env.KEEP_PACKAGE_SMOKE !== '1') {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  } else {
    process.stdout.write(`Package smoke-test files kept at ${temporaryDirectory}.\n`);
  }
}
