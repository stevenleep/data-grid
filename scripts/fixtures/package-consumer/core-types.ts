import {
  createGrid,
  createLocalSource,
  defineGrid,
  type GridDefinition,
  type GridQuery,
} from '@huiyun/data-grid/core';

interface Row {
  id: string;
  name: string;
}

const definition: GridDefinition<Row> = defineGrid<Row>({
  id: 'core-type-consumer',
  rowKey: 'id',
  fields: [{ id: 'name', title: 'Name' }],
});
const query: GridQuery = {
  pagination: { type: 'offset', page: 1, pageSize: 20 },
  keyword: '',
  filters: { id: 'root', type: 'group', logic: 'and', children: [] },
  sorts: [],
};
const instance = createGrid({ definition, source: createLocalSource<Row>([]) });

void instance;
void query;
