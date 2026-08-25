import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Extractor, ExtractorConfig } from '@microsoft/api-extractor';

const repositoryDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const localBuild = process.argv.includes('--local');
const entrypoints = ['core', 'react', 'antd', 'root'];

mkdirSync(join(repositoryDirectory, 'etc', 'api'), { recursive: true });
mkdirSync(join(repositoryDirectory, 'temp', 'api'), { recursive: true });

for (const entrypoint of entrypoints) {
  const configPath = join(repositoryDirectory, 'config', 'api-extractor', `${entrypoint}.json`);
  if (!existsSync(configPath)) throw new Error(`Missing API Extractor config: ${configPath}`);

  const config = ExtractorConfig.loadFileAndPrepare(configPath);
  const result = Extractor.invoke(config, {
    localBuild,
    showDiagnostics: false,
    showVerboseMessages: false,
  });

  if (!result.succeeded) {
    throw new Error(
      `Public API ${localBuild ? 'report update' : 'compatibility check'} failed for ${entrypoint} (${result.errorCount} errors, ${result.warningCount} warnings).`,
    );
  }

  // API Extractor writes reports with CRLF on every platform. Keep committed
  // artifacts deterministic and compatible with `git diff --check`.
  if (localBuild) {
    const reportPath = join(repositoryDirectory, 'etc', 'api', `${entrypoint}.api.md`);
    const report = readFileSync(reportPath, 'utf8');
    writeFileSync(reportPath, report.replace(/\r\n/g, '\n'));
  }
}

process.stdout.write(
  localBuild
    ? 'Public API reports updated. Review every diff and classify it before release.\n'
    : 'Public API reports match the committed contract.\n',
);
