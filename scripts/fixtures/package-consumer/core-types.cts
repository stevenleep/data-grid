import core = require('@stevenleep/data-grid/core');

interface Row {
  id: string;
}

const definition = core.defineGrid<Row>({
  id: 'core-commonjs-type-consumer',
  rowKey: 'id',
  fields: [{ id: 'id', title: 'ID' }],
});

void definition;
