import {
  GridActionButton,
  GridCell,
  GridEditableCell,
  type GridAction,
  type GridResolvedField,
} from '@huiyun/data-grid';

interface Row {
  id: string;
  name: string;
}

const row: Row = { id: 'row-1', name: 'Consumer' };
const field = null as unknown as GridResolvedField<Row>;
const action: GridAction<Row> = {
  id: 'inspect',
  label: 'Inspect',
  run: () => undefined,
};

// These direct JSX usages guard declaration compatibility across the supported
// React 18 and React 19 type ranges. The function is intentionally not invoked.
export function PublicComponentContracts() {
  return (
    <>
      <GridActionButton action={action} />
      <GridCell row={row} rowIndex={0} field={field} />
      <GridEditableCell row={row} rowIndex={0} field={field}>
        Consumer
      </GridEditableCell>
    </>
  );
}
