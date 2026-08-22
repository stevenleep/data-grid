import root = require('@huiyun/data-grid');
import core = require('@huiyun/data-grid/core');
import react = require('@huiyun/data-grid/react');
import antd = require('@huiyun/data-grid/antd');

interface Row {
  id: string;
}

const definition = core.defineGrid<Row>({
  id: 'commonjs-type-smoke',
  rowKey: 'id',
  fields: [{ id: 'id', title: 'ID' }],
});

const rootDefinition: typeof root.defineGrid = core.defineGrid;
const provider: typeof react.GridProvider = react.GridProvider;
const table = null as unknown as antd.GridTableProps<Row>;

void definition;
void provider;
void rootDefinition;
void table;
