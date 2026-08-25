const assert = require('node:assert/strict');
const core = require('@stevenleep/data-grid/core');
const { createGrid, createLocalSource, defineGrid } = core;

for (const implementationSymbol of [
  'GridStore',
  'definitionSignature',
  'isResolvedGridDefinition',
  'cloneJson',
  'createGridId',
  'normalizeError',
]) {
  assert.equal(
    implementationSymbol in core,
    false,
    `${implementationSymbol} leaked through the public Core runtime entry`,
  );
}

const definition = defineGrid({
  id: 'core-cjs-consumer',
  rowKey: 'id',
  fields: [{ id: 'name', title: 'Name' }],
});
const instance = createGrid({
  definition,
  source: createLocalSource([{ id: 'row-1', name: 'Core only' }]),
});

assert.equal(instance.definition.id, 'core-cjs-consumer');
instance.destroy();
