const assert = require('node:assert/strict');
const { createGrid, createLocalSource, defineGrid } = require('@huiyun/data-grid/core');

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
