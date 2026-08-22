const assert = require('node:assert/strict');
const root = require('@huiyun/data-grid');
const core = require('@huiyun/data-grid/core');
const react = require('@huiyun/data-grid/react');
const antd = require('@huiyun/data-grid/antd');

assert.equal(typeof root.defineGrid, 'function');
assert.equal(root.defineGrid, core.defineGrid);
assert.equal(typeof react.GridProvider, 'function');
assert.equal(typeof antd.DataGrid, 'function');
assert.match(require.resolve('@huiyun/data-grid/style.css'), /style\.css$/);
