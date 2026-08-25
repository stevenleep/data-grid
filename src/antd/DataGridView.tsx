import { App as AntApp, Button, ConfigProvider, Space } from 'antd';
import { useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react';
import type { GridInstance } from '../core';
import { GridProvider, useGridInstance } from '../react';
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
import { resolveGridLocale } from './locale';
import { GridRenderErrorBoundary } from './render';
import { useGridSelectionCount, useResolvedGridSelectionMode } from './selection-mode';
import { GridSortTrigger } from './sort';
import { GridTable } from './table';
import type {
  DataGridSlot,
  DataGridViewProps,
  GridFooterFeatures,
  GridToolbarFeatures,
  GridUiConfig,
} from './types';
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
    return <GridSelectionBar<Row> actions={features.actions} />;
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

function renderDataGridSlot<Row extends object>(
  slot: DataGridSlot<Row> | undefined,
  defaultContent: ReactNode,
  instance: GridInstance<Row>,
): ReactNode {
  if (slot === undefined) return defaultContent;
  return typeof slot === 'function' ? slot(defaultContent, instance) : slot;
}

function DataGridContent<Row extends object>({
  instance,
  props,
}: {
  instance: GridInstance<Row>;
  props: DataGridViewProps<Row>;
}) {
  if (typeof props.children === 'function') return props.children(instance);
  if (props.children !== undefined && props.children !== null) return props.children;

  const toolbar =
    props.toolbar === false ? null : <GridDefaultToolbar<Row> features={props.toolbar} />;
  const footer = props.footer === false ? null : <GridDefaultFooter<Row> features={props.footer} />;

  return (
    <GridShell className={props.className} style={props.style}>
      {renderDataGridSlot(props.slots?.toolbar, toolbar, instance)}
      {renderDataGridSlot(props.slots?.activeFilters, <GridActiveFilters<Row> />, instance)}
      {props.beforeTable}
      {renderDataGridSlot(props.slots?.status, <GridStatus<Row> />, instance)}
      {renderDataGridSlot(
        props.slots?.table,
        <GridTable<Row> rowActions={props.rowActions} />,
        instance,
      )}
      {props.afterTable}
      {renderDataGridSlot(props.slots?.footer, footer, instance)}
    </GridShell>
  );
}

function DataGridRenderBoundary<Row extends object>({
  instance,
  props,
  children,
}: {
  instance: GridInstance<Row>;
  props: DataGridViewProps<Row>;
  children: ReactNode;
}) {
  const locale = resolveGridLocale(props.locale, props.language);
  return (
    <GridRenderErrorBoundary
      resetKey={props.children ?? instance.definition}
      onError={props.onRenderError}
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

/**
 * Renders an existing grid instance with the official AntD composition.
 * Instance creation, option updates and lifecycle remain owned by the caller.
 */
export function DataGridView<Row extends object>(props: DataGridViewProps<Row>) {
  const instance = props.grid;
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
      cellRenderers: props.cellRenderers,
      cellEditors: props.cellEditors,
      renderEmpty: props.renderEmpty,
      renderError: props.renderError,
      onRenderError: props.onRenderError,
    }),
    [
      props.antdLocale,
      props.cellEditors,
      props.cellRenderers,
      props.isCellClickable,
      props.isRowClickable,
      props.language,
      props.locale,
      props.onCellClick,
      props.onRenderError,
      props.onRowClick,
      props.pageSizeOptions,
      props.renderEmpty,
      props.renderError,
      props.selection,
      props.tableProps,
      props.theme,
      props.timeZone,
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
            <DataGridRenderBoundary instance={instance} props={props}>
              <DataGridContent instance={instance} props={props} />
            </DataGridRenderBoundary>
          </AntApp>
        </ConfigProvider>
      </GridUiProvider>
    </GridProvider>
  );
}
