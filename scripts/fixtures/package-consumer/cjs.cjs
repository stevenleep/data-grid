const assert = require('node:assert/strict');
const root = require('@stevenleep/data-grid');
const core = require('@stevenleep/data-grid/core');
const react = require('@stevenleep/data-grid/react');
const antd = require('@stevenleep/data-grid/antd');

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
assert.match(require.resolve('@stevenleep/data-grid/style.css'), /style\.css$/);
