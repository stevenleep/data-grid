import { createRoot } from 'react-dom/client';
import { createLocalSource, DataGrid, defineGrid } from '@huiyun/data-grid';
import '@huiyun/data-grid/style.css';

const rows = [{ id: 'row-1', name: 'Packed Vite consumer' }];
const definition = defineGrid({
  id: 'packed-vite-consumer',
  rowKey: 'id',
  fields: [{ id: 'name', title: 'Name' }],
});

createRoot(document.getElementById('root')!).render(
  <DataGrid definition={definition} source={createLocalSource(rows)} />,
);
