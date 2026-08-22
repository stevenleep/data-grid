import {
  DataGrid,
  defineGrid,
  GridProvider,
  type DataGridProps,
  type GridDefinition,
} from '@huiyun/data-grid';
import { defineGrid as defineCoreGrid, type GridQuery } from '@huiyun/data-grid/core';
import { useGrid, type GridProviderProps } from '@huiyun/data-grid/react';
import { GridTable, type GridTableProps } from '@huiyun/data-grid/antd';
import stylesheet from '@huiyun/data-grid/style.css';

interface Row {
  id: string;
  name: string;
}

const definition = defineGrid<Row>({
  id: 'consumer-smoke',
  rowKey: 'id',
  fields: [{ id: 'name', title: 'Name' }],
});

const coreDefinition: GridDefinition<Row> = defineCoreGrid<Row>({
  id: 'core-consumer-smoke',
  rowKey: 'id',
  fields: [{ id: 'name', title: 'Name' }],
});

const query: GridQuery = {
  pagination: { type: 'offset', page: 1, pageSize: 20 },
  keyword: '',
  filters: { id: 'root', type: 'group', logic: 'and', children: [] },
  sorts: [],
};

const dataGridProps: DataGridProps<Row> = { definition, source: { mode: 'local', rows: [] } };
const tableProps: GridTableProps<Row> = {};
const providerProps = null as unknown as GridProviderProps<Row>;

void DataGrid;
void GridProvider;
void GridTable;
void coreDefinition;
void dataGridProps;
void providerProps;
void query;
void stylesheet;
void tableProps;
void useGrid;
