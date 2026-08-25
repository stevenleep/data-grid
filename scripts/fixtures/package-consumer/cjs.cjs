const assert = require('node:assert/strict');
const root = require('@huiyun/data-grid');
const core = require('@huiyun/data-grid/core');
const react = require('@huiyun/data-grid/react');
const antd = require('@huiyun/data-grid/antd');

assert.equal(typeof root.defineGrid, 'function');
assert.equal(root.defineGrid, core.defineGrid);
assert.equal(typeof react.GridProvider, 'function');
assert.equal(typeof antd.DataGrid, 'function');
assert.equal(typeof antd.DataGridView, 'function');
assert.equal(typeof antd.supportsGridDefaultEditor, 'function');
assert.equal(typeof root.DataGridView, 'function');
assert.equal(Object.hasOwn(react, 'createGrid'), false);
assert.equal(Object.hasOwn(react, 'defineGrid'), false);
assert.equal(Object.hasOwn(antd, 'createGrid'), false);
assert.equal(Object.hasOwn(antd, 'defineGrid'), false);
assert.equal(Object.hasOwn(core, 'DataGrid'), false);
assert.match(require.resolve('@huiyun/data-grid/style.css'), /style\.css$/);
