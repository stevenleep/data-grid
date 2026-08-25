import root = require('@stevenleep/data-grid');
import core = require('@stevenleep/data-grid/core');
import react = require('@stevenleep/data-grid/react');
import antd = require('@stevenleep/data-grid/antd');

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
