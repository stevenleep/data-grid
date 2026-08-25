import assert from 'node:assert/strict';
import { createElement, version as reactVersion } from 'react';
import { renderToString } from 'react-dom/server';
import * as root from '@stevenleep/data-grid';
import * as core from '@stevenleep/data-grid/core';
import * as react from '@stevenleep/data-grid/react';
import * as antd from '@stevenleep/data-grid/antd';

const expectedReactMajor = process.argv[2];
assert.ok(expectedReactMajor, 'Expected the React major as the first argument.');
assert.equal(reactVersion.split('.')[0], expectedReactMajor);

assert.equal(typeof root.defineGrid, 'function');
assert.equal(root.defineGrid, core.defineGrid);
assert.equal(typeof react.GridProvider, 'function');
assert.equal(typeof antd.DataGrid, 'function');
assert.equal(typeof antd.DataGridView, 'function');
assert.equal(typeof antd.supportsGridDefaultEditor, 'function');
assert.equal(typeof root.DataGridView, 'function');

// The framework entrypoints intentionally expose Core contracts as types only.
// Guard the runtime layer boundary so a future `export *` does not silently pull
// the store/query implementation into renderer-only bundles.
assert.equal(Object.hasOwn(react, 'createGrid'), false);
assert.equal(Object.hasOwn(react, 'defineGrid'), false);
assert.equal(Object.hasOwn(antd, 'createGrid'), false);
assert.equal(Object.hasOwn(antd, 'defineGrid'), false);
assert.equal(Object.hasOwn(core, 'DataGrid'), false);

const stylesheetUrl = import.meta.resolve('@stevenleep/data-grid/style.css');
assert.match(stylesheetUrl, /style\.css$/);

const rows = [{ id: 'order-1', orderNo: 'SO-1001' }];
const definition = root.defineGrid({
  id: 'package-runtime-smoke',
  rowKey: 'id',
  fields: [
    {
      id: 'orderNo',
      title: 'Order number',
      path: ['orderNo'],
    },
  ],
});
const html = renderToString(
  createElement(root.DataGrid, {
    definition,
    source: root.createLocalSource(rows),
    defaultState: {
      data: {
        status: 'success',
        fetching: false,
        rows,
        total: { value: rows.length, accuracy: 'exact' },
        summary: [],
        facets: {},
        warnings: [],
      },
    },
    toolbar: false,
    footer: false,
  }),
);

assert.match(html, /hui-grid/);
assert.match(html, /Order number/);
assert.match(html, /SO-1001/);
