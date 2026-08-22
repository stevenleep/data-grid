import { App as AntApp, ConfigProvider, Space } from 'antd';
import { useEffect, useMemo, type ReactNode } from 'react';
import { GridProvider, useGrid, useGridSelector } from '../react';
import { useGridInstance } from '../react';
import { GridActions, GridSelectionBar } from './actions';
import { GridColumnTrigger } from './columns';
import { GridUiProvider, useGridUi } from './context';
import { GridFilterTrigger } from './filter';
import {
  GridActiveFilters,
  GridDensityMenu,
  GridFooter,
  GridPagination,
  GridRefresh,
  GridSearch,
  GridSelectionSummary,
  GridShell,
  GridStatus,
  GridSummary,
  GridToolbar,
  GridTotal,
} from './layout';
import { GridSortTrigger } from './sort';
import { GridTable } from './table';
import type { DataGridProps, GridFooterFeatures, GridToolbarFeatures, GridUiConfig } from './types';
import { GridViewTrigger } from './views';

const defaultToolbar: Required<GridToolbarFeatures> = {
  views: true,
  columns: true,
  filters: true,
  sorts: true,
  search: true,
  refresh: true,
  density: true,
  actions: true,
};

const defaultFooter: Required<GridFooterFeatures> = {
  selection: true,
  summary: true,
  total: true,
  pagination: true,
};

function GridDefaultToolbarEnd<Row extends object>({
  features,
}: {
  features: Required<GridToolbarFeatures>;
}) {
  const selection = useGridSelector<Row, { count: number }>(
    (state) => ({
      count:
        state.selection.mode === 'explicit'
          ? state.selection.selectedKeys.length
          : Math.max(0, state.selection.total - state.selection.excludedKeys.length),
    }),
    (left, right) => left.count === right.count,
  );
  if (selection.count) {
    return (
      <>
        <GridSelectionBar<Row> />
      </>
    );
  }
  return (
    <Space size={2} wrap>
      {features.actions && <GridActions<Row> placement="toolbar" />}
      {features.refresh && <GridRefresh<Row> />}
      {features.density && <GridDensityMenu<Row> />}
    </Space>
  );
}

export interface GridDefaultToolbarProps {
  features?: GridToolbarFeatures;
}

export function GridDefaultToolbar<Row extends object>({
  features: input,
}: GridDefaultToolbarProps = {}) {
  const instance = useGridInstance<Row>();
  const features = {
    ...defaultToolbar,
    ...input,
    views: input?.views ?? instance.definition.defaults?.views ?? true,
    search: (input?.search ?? defaultToolbar.search) && instance.capabilities.search,
  };
  return (
    <GridToolbar
      start={
        <>
          {features.views && <GridViewTrigger<Row> />}
          {features.columns && <GridColumnTrigger<Row> />}
          {features.filters && <GridFilterTrigger<Row> />}
          {features.sorts && <GridSortTrigger<Row> />}
          {features.search && <GridSearch<Row> />}
        </>
      }
      end={<GridDefaultToolbarEnd<Row> features={features} />}
    />
  );
}

export interface GridDefaultFooterProps {
  features?: GridFooterFeatures;
}

export function GridDefaultFooter<Row extends object>({
  features: input,
}: GridDefaultFooterProps = {}) {
  const instance = useGridInstance<Row>();
  const ui = useGridUi<Row>();
  const features = {
    ...defaultFooter,
    ...input,
    selection:
      input?.selection ?? Boolean(ui.selection ?? instance.definition.defaults?.selection ?? false),
  };
  return (
    <GridFooter
      start={
        <>
          {features.selection && <GridSelectionSummary<Row> />}
          {features.summary && <GridSummary<Row> />}
          {features.total && <GridTotal<Row> />}
        </>
      }
      end={features.pagination ? <GridPagination<Row> /> : undefined}
    />
  );
}

export function DataGrid<Row extends object>(props: DataGridProps<Row>) {
  const instance = useGrid<Row>(props);
  const ui = useMemo<GridUiConfig<Row>>(
    () => ({
      locale: props.locale,
      language: props.language,
      timeZone: props.timeZone,
      theme: props.theme,
      antdLocale: props.antdLocale,
      pageSizeOptions: props.pageSizeOptions,
      selection: props.selection,
      tableProps: props.tableProps,
      onRowClick: props.onRowClick,
      onCellClick: props.onCellClick,
      isRowClickable: props.isRowClickable,
      isCellClickable: props.isCellClickable,
      renderEmpty: props.renderEmpty,
      renderError: props.renderError,
    }),
    [
      props.antdLocale,
      props.language,
      props.locale,
      props.pageSizeOptions,
      props.onCellClick,
      props.onRowClick,
      props.isCellClickable,
      props.isRowClickable,
      props.renderEmpty,
      props.renderError,
      props.selection,
      props.tableProps,
      props.theme,
      props.timeZone,
    ],
  );

  useEffect(() => {
    if (!props.onEvent) return;
    return instance.subscribeEvent((event) => props.onEvent?.(event, instance.getState()));
  }, [instance, props.onEvent]);

  const content: ReactNode =
    typeof props.children === 'function' ? (
      props.children(instance)
    ) : props.children ? (
      props.children
    ) : (
      <GridShell className={props.className} style={props.style}>
        {props.toolbar !== false && <GridDefaultToolbar<Row> features={props.toolbar} />}
        <GridActiveFilters<Row> />
        {props.beforeTable}
        <GridStatus<Row> />
        <GridTable<Row> rowActions={props.rowActions} />
        {props.afterTable}
        {props.footer !== false && <GridDefaultFooter<Row> features={props.footer} />}
      </GridShell>
    );

  return (
    <GridProvider value={instance}>
      <GridUiProvider value={ui}>
        <ConfigProvider theme={props.theme} locale={props.antdLocale}>
          <AntApp component={false}>{content}</AntApp>
        </ConfigProvider>
      </GridUiProvider>
    </GridProvider>
  );
}
