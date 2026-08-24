import assert from 'node:assert/strict';
import { createGrid, createLocalSource, defineGrid } from '@huiyun/data-grid/core';

const definition = defineGrid({
  id: 'core-esm-consumer',
  rowKey: 'id',
  fields: [{ id: 'name', title: 'Name' }],
});
const instance = createGrid({
  definition,
  source: createLocalSource([{ id: 'row-1', name: 'Core only' }]),
});

assert.equal(instance.definition.id, 'core-esm-consumer');
instance.destroy();
