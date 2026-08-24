import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generatedArtifacts = [
  'style.mjs',
  'style.mjs.map',
  'style.cjs',
  'style.cjs.map',
  'style.d.mts',
  'style.d.mts.map',
  'style.d.cts',
  'style.d.cts.map',
];

for (const artifact of generatedArtifacts) {
  rmSync(resolve(repositoryDirectory, 'dist', artifact), { force: true });
}
