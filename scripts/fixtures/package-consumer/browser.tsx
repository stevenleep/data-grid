import { createRoot } from 'react-dom/client';
import { createFieldHelper, createLocalSource, DataGrid, defineGrid } from '@stevenleep/data-grid';
import '@stevenleep/data-grid/style.css';

declare global {
  interface Window {
    __gridRowClicks: number;
    __gridSaves: Array<{
      rowKey: string | number;
      fieldId: string;
      value: unknown;
      encodedValue: unknown;
    }>;
    __unmountGrid: () => void;
  }
}

window.__gridRowClicks = 0;
window.__gridSaves = [];

interface Row {
  id: string;
  name: string;
  rank: number;
}

const rows: Row[] = [
  { id: 'row-1', name: 'Zulu', rank: 4 },
  { id: 'row-2', name: 'Alpha', rank: 1 },
  { id: 'row-3', name: 'Mike', rank: 3 },
  { id: 'row-4', name: 'Beta', rank: 2 },
];
const field = createFieldHelper<Row>();
const definition = defineGrid<Row>({
  id: 'packed-vite-consumer',
  rowKey: 'id',
  defaults: { pageSize: 2 },
  fields: [
    field.property('name', {
      title: 'Name',
      filter: true,
      sort: true,
      edit: { enabled: true, required: true },
    }),
    field.property('rank', {
      title: 'Rank',
      valueType: 'number',
      filter: true,
      sort: true,
    }),
  ],
  editing: {
    optimistic: true,
    apply: (row, resolvedField, value) =>
      resolvedField.id === 'name' ? { ...row, name: String(value) } : row,
    save: async ({ row, rowKey, field: resolvedField, value, encodedValue }) => {
      window.__gridSaves.push({
        rowKey,
        fieldId: resolvedField.id,
        value,
        encodedValue,
      });
      return resolvedField.id === 'name' ? { ...row, name: String(value) } : row;
    },
  },
});

const root = createRoot(document.getElementById('root')!);
window.__unmountGrid = () => root.unmount();
root.render(
  <DataGrid
    definition={definition}
    source={createLocalSource(rows)}
    language="en-US"
    pageSizeOptions={[2, 4]}
    toolbar={{
      views: false,
      columns: false,
      filters: false,
      sorts: true,
      search: true,
      refresh: false,
      density: false,
      actions: false,
    }}
    footer={{ selection: false, summary: false, total: true, pagination: true }}
    onRowClick={() => {
      window.__gridRowClicks += 1;
    }}
  />,
);
