const expectedMajor = Number(process.argv[2]);
const actualMajor = Number(process.versions.node.split('.')[0]);

if (!Number.isInteger(expectedMajor)) {
  throw new Error('Usage: node scripts/assert-node-major.mjs <major>');
}

if (actualMajor !== expectedMajor) {
  throw new Error(`Expected Node.js ${expectedMajor}.x, received ${process.version}.`);
}

process.stdout.write(`Using Node.js ${process.version}.\n`);
