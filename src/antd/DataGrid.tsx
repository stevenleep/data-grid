import { createGridEvent, type GridOptions } from '../core';
import { useGrid } from '../react';
import { DataGridView } from './DataGridView';
import type { DataGridProps } from './types';

export { DataGridView, GridDefaultFooter, GridDefaultToolbar } from './DataGridView';
export type { GridDefaultFooterProps, GridDefaultToolbarProps } from './DataGridView';

/** Creates and owns a grid instance, then renders it through DataGridView. */
export function DataGrid<Row extends object>(props: DataGridProps<Row>) {
  const effectiveTimeZone = props.temporal?.timeZone ?? props.timeZone;
  const gridOptions: GridOptions<Row> = {
    ...props,
    temporal:
      props.temporal || effectiveTimeZone
        ? {
            ...props.temporal,
            timeZone: effectiveTimeZone,
          }
        : undefined,
  };
  const instance = useGrid<Row>(gridOptions);

  return (
    <DataGridView
      {...props}
      grid={instance}
      timeZone={effectiveTimeZone}
      onRenderError={(error, info) => {
        props.onRenderError?.(error, info);
        props.onError?.(
          error,
          createGridEvent('render.error', 'system', {
            componentStack: info.componentStack || undefined,
          }),
        );
      }}
    />
  );
}
