import assert from 'node:assert/strict';
import { createElement, version as reactVersion } from 'react';
import { renderToString } from 'react-dom/server';
import * as root from '@huiyun/data-grid';
import * as core from '@huiyun/data-grid/core';
import * as react from '@huiyun/data-grid/react';
import * as antd from '@huiyun/data-grid/antd';

const expectedReactMajor = process.argv[2];
assert.ok(expectedReactMajor, 'Expected the React major as the first argument.');
assert.equal(reactVersion.split('.')[0], expectedReactMajor);

assert.equal(typeof root.defineGrid, 'function');
assert.equal(root.defineGrid, core.defineGrid);
assert.equal(typeof react.GridProvider, 'function');
assert.equal(typeof antd.DataGrid, 'function');

const stylesheetUrl = import.meta.resolve('@huiyun/data-grid/style.css');
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
