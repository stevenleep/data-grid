import {
  DataGrid,
  createControlledSource,
  defineGrid,
  GridProvider,
  type DataGridProps,
  type GridDefinition,
  type GridPaginationState,
  type GridTotalValue,
} from '@stevenleep/data-grid';
import { defineGrid as defineCoreGrid, type GridQuery } from '@stevenleep/data-grid/core';
import { useGrid, type GridProviderProps } from '@stevenleep/data-grid/react';
import { GridTable, type GridTableProps } from '@stevenleep/data-grid/antd';
import '@stevenleep/data-grid/style.css';

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
const controlledSource = createControlledSource<Row>({
  datasetKey: 'consumer:orders',
  resultDatasetKey: 'consumer:orders',
  result: { rows: [] },
  error: {
    value: new Error('consumer error'),
    requestSignature: 'consumer-request',
    datasetKey: 'consumer:orders',
  },
});
const dynamicControlledBootstrap = createControlledSource<Row>({
  result: { rows: [] },
  onQueryChange: () => undefined,
});
const controlledStateProps: DataGridProps<Row> = {
  definition,
  source: controlledSource,
  state: {
    selection: { mode: 'explicit', selectedKeys: [] },
  },
  stateDatasetKey: 'consumer:orders',
};
// @ts-expect-error dataset-backed controlled results require explicit provenance.
createControlledSource<Row>({ datasetKey: 'consumer:orders', result: { rows: [] } });
const tableProps: GridTableProps<Row> = {};
const providerProps = null as unknown as GridProviderProps<Row>;
const paginationState: GridPaginationState = { type: 'offset', page: 1, pageSize: 20 };
const totalValue: GridTotalValue = { value: 1, accuracy: 'exact' };

void DataGrid;
void GridProvider;
void GridTable;
void coreDefinition;
void dataGridProps;
void controlledStateProps;
void dynamicControlledBootstrap;
void paginationState;
void providerProps;
void query;
void tableProps;
void totalValue;
void useGrid;
