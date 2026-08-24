import { App as AntApp, Button, ConfigProvider, Space } from 'antd';
import { useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { createGridEvent, type GridInstance, type GridOptions } from '../core';
import { GridProvider, useGrid } from '../react';
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
import { resolveGridLocale } from './locale';
import { GridRenderErrorBoundary } from './render';
import { useGridSelectionCount, useResolvedGridSelectionMode } from './selection-mode';
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

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function GridDefaultToolbarEnd<Row extends object>({
  features,
}: {
  features: Required<GridToolbarFeatures>;
}) {
  const instance = useGridInstance<Row>();
  const ui = useGridUi<Row>();
  const configuredSelection = ui.selection ?? instance.definition.defaults?.selection;
  const configuredSelectionProps =
    typeof configuredSelection === 'object' ? configuredSelection : undefined;
  const selectionMode = useResolvedGridSelectionMode(
    instance,
    configuredSelection
      ? configuredSelectionProps?.type === 'radio'
        ? 'radio'
        : 'checkbox'
      : undefined,
  );
  const selectionCount = useGridSelectionCount(instance, selectionMode);
  if (selectionCount) {
    return (
      <>
        <GridSelectionBar<Row> actions={features.actions} />
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
    filters:
      (input?.filters ?? defaultToolbar.filters) &&
      instance.capabilities.filter.maxConditions > 0 &&
      instance.definition.fields.some((field) => {
        if (!field.filter) return false;
        const operators = field.filter.operators || ['equals'];
        const sourceOperators = instance.capabilities.filter.operators;
        return !sourceOperators || operators.some((operator) => sourceOperators.includes(operator));
      }),
    sorts:
      (input?.sorts ?? defaultToolbar.sorts) &&
      instance.capabilities.sort.max > 0 &&
      instance.definition.fields.some((field) => Boolean(field.sort)),
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

function DataGridContent<Row extends object>({ props }: { props: DataGridProps<Row> }) {
  const instance = useGridInstance<Row>();
  if (typeof props.children === 'function') return props.children(instance);
  if (props.children !== undefined && props.children !== null) return props.children;
  return (
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
}

function DataGridRenderBoundary<Row extends object>({
  props,
  children,
}: {
  props: DataGridProps<Row>;
  children: ReactNode;
}) {
  const locale = resolveGridLocale(props.locale, props.language);
  return (
    <GridRenderErrorBoundary
      resetKey={props.children ?? props.definition}
      onError={(error, info) => {
        props.onError?.(
          error,
          createGridEvent('render.error', 'system', {
            componentStack: info.componentStack || undefined,
          }),
        );
      }}
      fallback={(_error, reset) => (
        <div className="hui-grid hui-grid__error" role="alert">
          <span>{locale.renderFailed}</span>
          <Button size="small" type="link" onClick={reset}>
            {locale.retry}
          </Button>
        </div>
      )}
    >
      {children}
    </GridRenderErrorBoundary>
  );
}

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
  const ui = useMemo<GridUiConfig<Row>>(
    () => ({
      locale: props.locale,
      language: props.language,
      timeZone: effectiveTimeZone,
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
      onRenderError: (error, info) => {
        props.onError?.(
          error,
          createGridEvent('render.error', 'system', {
            componentStack: info.componentStack || undefined,
          }),
        );
      },
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
      props.onError,
      props.selection,
      props.tableProps,
      props.theme,
      effectiveTimeZone,
    ],
  );

  useIsomorphicLayoutEffect(() => {
    if (!props.onEvent) return;
    return instance.subscribeEvent((event, state) => props.onEvent?.(event, state));
  }, [instance, props.onEvent]);

  return (
    <GridProvider value={instance}>
      <GridUiProvider value={ui}>
        <ConfigProvider theme={props.theme} locale={props.antdLocale}>
          <AntApp component="div" className="hui-grid__antd-app">
            <DataGridRenderBoundary props={props}>
              <DataGridContent props={props} />
            </DataGridRenderBoundary>
          </AntApp>
        </ConfigProvider>
      </GridUiProvider>
    </GridProvider>
  );
}
