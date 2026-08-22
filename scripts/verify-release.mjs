import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const tag = process.argv[2];
const githubOutput = process.argv[3];
const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const expectedTag = `v${packageJson.version}`;

if (tag !== expectedTag) {
  throw new Error(`Release tag ${String(tag)} does not match package version ${expectedTag}.`);
}

const distTag = packageJson.version.includes('-') ? 'next' : 'latest';

if (githubOutput) {
  appendFileSync(githubOutput, `dist-tag=${distTag}\n`);
}

process.stdout.write(`Release ${expectedTag} will publish with npm dist-tag ${distTag}.\n`);
