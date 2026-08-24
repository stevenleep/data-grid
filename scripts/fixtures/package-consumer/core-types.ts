import {
  createGrid,
  createLocalGridPersistence,
  createLocalSource,
  defineGrid,
  type GridDefinition,
  type GridQuery,
  type GridStorageLike,
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
const storage: GridStorageLike = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};
const persistence = createLocalGridPersistence({ scope: 'core-types', storage });
const unregisterProjection = instance.projection.register(['permission_key']);
unregisterProjection();

void instance;
void instance.flushPersistence();
void persistence;
void query;
