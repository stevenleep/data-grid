import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const repositoryDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(repositoryDirectory, 'examples', 'demo', 'dist');
const maxChunkGzipBytes = Number(process.env.DEMO_MAX_CHUNK_GZIP_KIB ?? 150) * 1024;
const maxTotalGzipBytes = Number(process.env.DEMO_MAX_TOTAL_GZIP_KIB ?? 500) * 1024;

function listFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

const javascriptFiles = listFiles(outputDirectory).filter((file) => extname(file) === '.js');
assert.ok(javascriptFiles.length > 1, 'Demo must emit multiple JavaScript chunks.');

const measurements = javascriptFiles
  .map((file) => {
    const contents = readFileSync(file);
    return {
      file: relative(outputDirectory, file),
      rawBytes: contents.byteLength,
      gzipBytes: gzipSync(contents, { level: 9 }).byteLength,
    };
  })
  .sort((left, right) => right.gzipBytes - left.gzipBytes);

const totalGzipBytes = measurements.reduce(
  (total, measurement) => total + measurement.gzipBytes,
  0,
);
const largestChunk = measurements[0];

for (const measurement of measurements) {
  process.stdout.write(
    `${measurement.file}: ${(measurement.rawBytes / 1024).toFixed(2)} kB raw, ${(measurement.gzipBytes / 1024).toFixed(2)} kB gzip\n`,
  );
}
process.stdout.write(`Total JavaScript gzip: ${(totalGzipBytes / 1024).toFixed(2)} kB\n`);

assert.ok(
  largestChunk.gzipBytes <= maxChunkGzipBytes,
  `${largestChunk.file} is ${(largestChunk.gzipBytes / 1024).toFixed(2)} kB gzip; limit is ${maxChunkGzipBytes / 1024} kB.`,
);
assert.ok(
  totalGzipBytes <= maxTotalGzipBytes,
  `Demo JavaScript is ${(totalGzipBytes / 1024).toFixed(2)} kB gzip in total; limit is ${maxTotalGzipBytes / 1024} kB.`,
);
