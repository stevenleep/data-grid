import {
  CalendarOutlined,
  DollarOutlined,
  FileOutlined,
  FontColorsOutlined,
  LinkOutlined,
  NumberOutlined,
  PercentageOutlined,
  TagsOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Table, Tooltip, type TableColumnsType, type TableProps } from 'antd';
import type { ColumnType, SorterResult } from 'antd/es/table/interface';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  countFilterConditions,
  type GridColumnState,
  type GridResolvedColumn,
  type GridResolvedField,
  type GridSort,
} from '../core';
import { createGridId } from '../core/model';
import { useGridInstance, useGridSelector } from '../react';
import { GridActions } from './actions';
import { GridCell, GridEditableCell } from './cells';
import { useGridUi } from './context';
import { resolveGridLocale } from './locale';
import { GridRenderErrorBoundary, gridNodeText, renderGridNode } from './render';
import { usePublishGridSelectionMode } from './selection-mode';
import type {
  GridCellClickContext,
  GridCellInteractionContext,
  GridRowClickContext,
  GridRowInteractionContext,
  GridRowActionsConfig,
  GridTablePlatformProps,
  GridTableSelectionProps,
} from './types';

function fieldIcon(valueType: string) {
  if (['number', 'decimal', 'duration'].includes(valueType)) return <NumberOutlined />;
  if (valueType === 'money') return <DollarOutlined />;
  if (valueType === 'percent') return <PercentageOutlined />;
  if (['date', 'dateTime'].includes(valueType)) return <CalendarOutlined />;
  if (['select', 'multiSelect', 'status'].includes(valueType)) return <TagsOutlined />;
  if (valueType === 'user') return <UserOutlined />;
  if (valueType === 'relation' || valueType === 'link') return <LinkOutlined />;
  if (valueType === 'file' || valueType === 'image') return <FileOutlined />;
  return <FontColorsOutlined />;
}

function leafColumns<Row extends object>(
  columns: readonly GridResolvedColumn<Row>[],
): GridResolvedColumn<Row>[] {
  return columns.flatMap((column) =>
    column.children?.length ? leafColumns(column.children) : [column],
  );
}

function columnMap<Row extends object>(
  columns: readonly GridResolvedColumn<Row>[],
): Map<string, GridResolvedColumn<Row>> {
  const result = new Map<string, GridResolvedColumn<Row>>();
  const visit = (items: readonly GridResolvedColumn<Row>[]) => {
    items.forEach((column) => {
      result.set(column.id, column);
      if (column.children?.length) visit(column.children);
    });
  };
  visit(columns);
  return result;
}

const platformFilterKeys = [
  'filters',
  'filterDropdown',
  'filterDropdownProps',
  'filterIcon',
  'filterOnClose',
  'filterSearch',
  'filterResetToDefaultFilteredValue',
  'filtered',
  'filteredValue',
  'defaultFilteredValue',
  'onFilter',
] as const;

function stripPlatformFilters<Row extends object>(platform: ColumnType<Row>): ColumnType<Row> {
  const safe = { ...platform } as Record<string, unknown>;
  platformFilterKeys.forEach((key) => delete safe[key]);
  return safe as ColumnType<Row>;
}

function hasPlatformFilters<Row extends object>(
  columns: readonly GridResolvedColumn<Row>[],
): boolean {
  return columns.some((column) => {
    const platform = (column.platform || {}) as Record<string, unknown>;
    return (
      platformFilterKeys.some((key) => Object.prototype.hasOwnProperty.call(platform, key)) ||
      Boolean(column.children?.length && hasPlatformFilters(column.children))
    );
  });
}

function parsePixelWidth(value: number | string | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const match = /^\s*(\d+(?:\.\d+)?)px\s*$/i.exec(value);
    if (match) return Number(match[1]);
  }
  return fallback;
}

function focusRowSibling(
  element: HTMLElement,
  direction: -1 | 1,
  selector: string,
  preserveCell: boolean,
): void {
  const row = element.closest('tr');
  if (!row) return;
  const cell = preserveCell ? element.closest('td') : undefined;
  const cellIndex = cell ? Array.from(row.children).indexOf(cell) : -1;
  let sibling = direction < 0 ? row.previousElementSibling : row.nextElementSibling;
  while (sibling) {
    const target =
      cellIndex >= 0
        ? sibling.children[cellIndex]?.matches(selector)
          ? (sibling.children[cellIndex] as HTMLElement)
          : sibling.children[cellIndex]?.querySelector<HTMLElement>(selector)
        : sibling.matches(selector)
          ? (sibling as HTMLElement)
          : sibling.querySelector<HTMLElement>(selector);
    if (target) {
      target.focus();
      return;
    }
    sibling = direction < 0 ? sibling.previousElementSibling : sibling.nextElementSibling;
  }
}

const defaultRowActions: NonNullable<GridTableProps<object>['rowActions']> = {};
const emptyRequiredFields: readonly string[] = [];
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

function orderedColumns<Row extends object>(
  columns: readonly GridResolvedColumn<Row>[],
  state: GridColumnState,
): GridResolvedColumn<Row>[] {
  const hidden = new Set(state.hidden);
  const orderIndex = new Map(state.order.map((id, index) => [id, index]));
  const visit = (column: GridResolvedColumn<Row>): GridResolvedColumn<Row> | undefined => {
    if (column.children?.length) {
      const children = column.children
        .map(visit)
        .filter((item): item is GridResolvedColumn<Row> => Boolean(item))
        .sort((left, right) => minimumIndex(left) - minimumIndex(right));
      return children.length ? { ...column, children } : undefined;
    }
    return hidden.has(column.id) ? undefined : column;
  };
  const minimumIndex = (column: GridResolvedColumn<Row>): number => {
    if (!column.children?.length) return orderIndex.get(column.id) ?? Number.MAX_SAFE_INTEGER;
    return Math.min(...column.children.map(minimumIndex));
  };
  return columns
    .map(visit)
    .filter((item): item is GridResolvedColumn<Row> => Boolean(item))
    .sort((left, right) => minimumIndex(left) - minimumIndex(right));
}

export interface GridTableProps<Row extends object> {
  columns?: GridResolvedColumn<Row>[];
  /** Semantic definition field ids read by supplied/transient columns. Raw transport keys belong in definition.projection.requiredKeys. */
  requiredFields?: readonly string[];
  selection?: boolean | GridTableSelectionProps<Row>;
  rowActions?: false | GridRowActionsConfig;
  loading?: 'initial' | 'always' | 'never';
  className?: string;
  tableProps?: GridTablePlatformProps<Row>;
  onRowClick?: (context: GridRowClickContext<Row>) => void;
  onCellClick?: (context: GridCellClickContext<Row>) => void;
  isRowClickable?: (context: GridRowInteractionContext<Row>) => boolean;
  isCellClickable?: (context: GridCellInteractionContext<Row>) => boolean;
}

function classes(...values: Array<string | undefined | false>): string | undefined {
  const value = values.filter(Boolean).join(' ');
  return value || undefined;
}

function isInteractiveDescendant(
  target: EventTarget | null,
  currentTarget: EventTarget | null,
): boolean {
  if (!(target instanceof Element) || !(currentTarget instanceof Element)) return false;
  const interactive = target.closest(
    'a, button, input, select, textarea, summary, audio[controls], video[controls], [data-grid-stop-interaction], [aria-haspopup], [role="button"], [role="checkbox"], [role="combobox"], [role="link"], [role="menuitem"], [role="option"], [role="radio"], [role="slider"], [role="spinbutton"], [role="switch"], [role="tab"], [contenteditable]:not([contenteditable="false"])',
  );
  return Boolean(
    interactive && interactive !== currentTarget && currentTarget.contains(interactive),
  );
}

function GridResolvedCellContent<Row extends object>({
  column,
  field,
  row,
  rowIndex,
}: {
  column: GridResolvedColumn<Row>;
  field: GridResolvedField<Row> | undefined;
  row: Row;
  rowIndex: number;
}) {
  const instance = useGridInstance<Row>();
  const value = field?.getValue(row);
  if (column.render) {
    return renderGridNode(column.render({ value, row, rowIndex, column, field, instance }));
  }
  return field ? <GridCell row={row} rowIndex={rowIndex} field={field} /> : null;
}

export function GridTable<Row extends object>({
  columns: supplied,
  requiredFields = emptyRequiredFields,
  selection: selectionOverride,
  rowActions = defaultRowActions,
  loading = 'always',
  className,
  tableProps: localTableProps,
  onRowClick: localOnRowClick,
  onCellClick: localOnCellClick,
  isRowClickable: localIsRowClickable,
  isCellClickable: localIsCellClickable,
}: GridTableProps<Row> = {}) {
  const instance = useGridInstance<Row>();
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  const data = useGridSelector<Row, ReturnType<typeof instance.getState>['data']>(
    (state) => state.data,
  );
  const columnState = useGridSelector<Row, GridColumnState>((state) => state.columns);
  const selection = useGridSelector<Row, ReturnType<typeof instance.getState>['selection']>(
    (state) => state.selection,
  );
  const sorts = useGridSelector<Row, GridSort[]>((state) => state.query.sorts);
  const filters = useGridSelector<Row, ReturnType<typeof instance.getState>['query']['filters']>(
    (state) => state.query.filters,
  );
  const keyword = useGridSelector<Row, string>((state) => state.query.keyword);
  const maximumSorts = instance.capabilities.sort.max;
  const wrapRef = useRef<HTMLDivElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const resizeCleanupRef = useRef<() => void>(() => undefined);
  const tableProps = { ...ui.tableProps, ...localTableProps } as TableProps<Row>;
  const onRowClick = localOnRowClick || ui.onRowClick;
  const onCellClick = localOnCellClick || ui.onCellClick;
  const isRowClickable = localIsRowClickable || ui.isRowClickable;
  const isCellClickable = localIsCellClickable || ui.isCellClickable;
  const definitionColumns = supplied || instance.definition.columns;
  const effectiveColumnMap = useMemo(() => columnMap(definitionColumns), [definitionColumns]);
  const projectionFields = useMemo(
    () =>
      [
        ...new Set([
          ...requiredFields,
          ...(supplied
            ? leafColumns(orderedColumns(definitionColumns, columnState))
                .map((column) => column.fieldId)
                .filter((fieldId): fieldId is string => Boolean(fieldId))
            : []),
        ]),
      ].sort(),
    [columnState, definitionColumns, requiredFields, supplied],
  );
  const projectionFieldSignature = JSON.stringify(projectionFields);
  const rowActionConfig = rowActions === false ? undefined : rowActions;
  const hasRowActions = Boolean(
    rowActionConfig &&
    instance.definition.actions?.some((action) => (action.placement || 'toolbar') === 'row'),
  );

  useEffect(() => () => resizeCleanupRef.current(), []);
  useEffect(() => {
    if (!hasPlatformFilters(definitionColumns)) return;
    console.warn(
      '[huiyun/data-grid] AntD native column filters are ignored. Define filters on Grid fields so pagination, totals and remote queries stay consistent.',
    );
  }, [definitionColumns]);
  useIsomorphicLayoutEffect(
    () =>
      instance.capabilities.projection && projectionFields.length
        ? instance.projection.register(projectionFields)
        : undefined,
    [instance, instance.capabilities.projection, projectionFieldSignature],
  );

  const startResize = (
    event: React.PointerEvent,
    column: GridResolvedColumn<Row>,
    width: number,
  ) => {
    if (!instance.definition.columnMap.has(column.id)) return;
    if (event.button !== 0) return;
    resizeCleanupRef.current();
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const wrapLeft = wrapRef.current?.getBoundingClientRect().left || 0;
    const bodyCursor = document.body.style.cursor;
    document.body.style.cursor = 'col-resize';
    if (guideRef.current) {
      guideRef.current.hidden = false;
      guideRef.current.style.left = `${event.clientX - wrapLeft}px`;
    }
    const onMove = (moveEvent: PointerEvent) => {
      if (guideRef.current) guideRef.current.style.left = `${moveEvent.clientX - wrapLeft}px`;
    };
    const cleanup = () => {
      document.body.style.cursor = bodyCursor;
      if (guideRef.current) guideRef.current.hidden = true;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      resizeCleanupRef.current = () => undefined;
    };
    const finish = (upEvent: PointerEvent) => {
      cleanup();
      if (upEvent.type === 'pointerup') {
        instance.columns.setWidth(column.id, width + upEvent.clientX - startX);
      }
    };
    resizeCleanupRef.current = cleanup;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const columns = useMemo<TableColumnsType<Row>>(() => {
    const nodes = orderedColumns(definitionColumns, columnState);
    const build = (column: GridResolvedColumn<Row>): TableColumnsType<Row>[number] => {
      if (column.children?.length) {
        return {
          key: column.id,
          title: column.header
            ? renderGridNode(column.header(column, instance))
            : renderGridNode(column.title),
          children: column.children.map(build),
        };
      }
      const field = column.fieldId ? instance.definition.fieldMap.get(column.fieldId) : undefined;
      const managed = instance.definition.columnMap.has(column.id);
      const width = (managed ? columnState.widths[column.id] : undefined) || column.width || 160;
      const pinned =
        managed && Object.prototype.hasOwnProperty.call(columnState.pinned, column.id)
          ? columnState.pinned[column.id] || undefined
          : column.fixed;
      const activeSort = field ? sorts.find((sort) => sort.fieldId === field.id) : undefined;
      const activeSortIndex = field ? sorts.findIndex((sort) => sort.fieldId === field.id) : -1;
      const rawPlatform = (column.platform || {}) as ColumnType<Row>;
      const platform = stripPlatformFilters(rawPlatform);
      const minimumWidth = column.minWidth || 72;
      const maximumWidth = column.maxWidth || Number.MAX_SAFE_INTEGER;
      return {
        ...platform,
        key: column.id,
        width,
        fixed: pinned,
        align: column.align,
        ellipsis: column.ellipsis ?? !column.wrap,
        title: column.header ? (
          renderGridNode(column.header(column, instance))
        ) : (
          <div className="hui-grid__column-title">
            {field && (
              <span className="hui-grid__column-icon" aria-hidden>
                {fieldIcon(field.valueType)}
              </span>
            )}
            <Tooltip title={renderGridNode(column.description)}>
              <span className="hui-grid__column-label">{renderGridNode(column.title)}</span>
            </Tooltip>
            {managed && column.resizable !== false && (
              <span
                className="hui-grid__resize-handle"
                role="separator"
                tabIndex={0}
                aria-orientation="vertical"
                aria-label={locale.resizeColumn(gridNodeText(column.title) || column.id)}
                aria-valuemin={minimumWidth}
                aria-valuemax={maximumWidth}
                aria-valuenow={width}
                onPointerDown={(event) => startResize(event, column, width)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                    event.preventDefault();
                    instance.columns.setWidth(
                      column.id,
                      width + (event.key === 'ArrowLeft' ? -10 : 10),
                    );
                  }
                }}
              />
            )}
          </div>
        ),
        sorter:
          field?.sort && maximumSorts > 0
            ? maximumSorts > 1
              ? {
                  multiple: Math.max(1, activeSortIndex < 0 ? 1 : maximumSorts - activeSortIndex),
                }
              : true
            : undefined,
        sortOrder: activeSort ? (activeSort.direction === 'asc' ? 'ascend' : 'descend') : undefined,
        render: (_value: unknown, row: Row, rowIndex: number) => {
          const content = (
            <GridResolvedCellContent column={column} field={field} row={row} rowIndex={rowIndex} />
          );
          return (
            <GridRenderErrorBoundary
              resetKey={content}
              onError={ui.onRenderError}
              fallback={<span title={locale.renderFailed}>—</span>}
            >
              {field?.edit && instance.definition.editing ? (
                <GridEditableCell row={row} rowIndex={rowIndex} field={field}>
                  {content}
                </GridEditableCell>
              ) : (
                content
              )}
            </GridRenderErrorBoundary>
          );
        },
        onCell: (row: Row, rowIndex = 0) => {
          const suppliedCell = rawPlatform.onCell?.(row, rowIndex) || {};
          const context: GridCellInteractionContext<Row> = {
            row,
            rowIndex,
            column,
            field,
            value: field?.getValue(row),
            instance,
          };
          const clickable = Boolean(
            onCellClick && (isCellClickable ? isCellClickable(context) : true),
          );
          const accessibleLabel = field
            ? `${gridNodeText(field.title)}: ${gridNodeText(context.value)}`
            : gridNodeText(column.title);
          return {
            ...suppliedCell,
            className: classes(suppliedCell.className, clickable && 'hui-grid__cell--clickable'),
            tabIndex: suppliedCell.tabIndex ?? (clickable ? (rowIndex === 0 ? 0 : -1) : undefined),
            'data-grid-clickable-cell': clickable ? 'true' : undefined,
            'aria-keyshortcuts': clickable ? 'Enter Space ArrowUp ArrowDown' : undefined,
            'aria-label':
              suppliedCell['aria-label'] ??
              (clickable && accessibleLabel ? accessibleLabel : undefined),
            onClick: (event) => {
              suppliedCell.onClick?.(event);
              if (
                !event.defaultPrevented &&
                clickable &&
                !isInteractiveDescendant(event.target, event.currentTarget)
              ) {
                onCellClick?.({ ...context, event });
              }
            },
            onKeyDown: (event) => {
              suppliedCell.onKeyDown?.(event);
              if (
                !event.defaultPrevented &&
                clickable &&
                (event.key === 'Enter' || event.key === ' ') &&
                !isInteractiveDescendant(event.target, event.currentTarget)
              ) {
                event.preventDefault();
                event.currentTarget.click();
              }
              if (
                !event.defaultPrevented &&
                clickable &&
                event.target === event.currentTarget &&
                (event.key === 'ArrowUp' || event.key === 'ArrowDown')
              ) {
                event.preventDefault();
                focusRowSibling(
                  event.currentTarget,
                  event.key === 'ArrowUp' ? -1 : 1,
                  '[data-grid-clickable-cell="true"]',
                  true,
                );
              }
            },
          };
        },
        shouldCellUpdate:
          rawPlatform.shouldCellUpdate ??
          (column.render || field?.render || field?.edit
            ? undefined
            : (next: Row, previous: Row) => {
                if (!field) return next !== previous;
                return !Object.is(field.getValue(next), field.getValue(previous));
              }),
      };
    };
    const result = nodes.map(build);
    if (hasRowActions && rowActionConfig) {
      result.push({
        key: '__grid_actions',
        title: rowActionConfig.title ?? locale.actions,
        width: rowActionConfig.width || 132,
        fixed: 'right',
        align: 'center',
        render: (_value, row) => (
          <GridActions<Row>
            placement="row"
            row={row}
            maxVisible={rowActionConfig.maxVisible ?? 1}
            compact
            className="hui-grid__row-actions"
          />
        ),
      });
    }
    return result;
  }, [
    columnState,
    definitionColumns,
    hasRowActions,
    instance,
    isCellClickable,
    locale.actions,
    locale.renderFailed,
    locale.resizeColumn,
    maximumSorts,
    onCellClick,
    rowActionConfig,
    sorts,
    ui.onRenderError,
  ]);

  const uiSelection = selectionOverride ?? ui.selection ?? instance.definition.defaults?.selection;
  const suppliedSelection =
    typeof uiSelection === 'object'
      ? (uiSelection as NonNullable<TableProps<Row>['rowSelection']>)
      : undefined;
  const selectionMode = uiSelection
    ? suppliedSelection?.type === 'radio'
      ? 'radio'
      : 'checkbox'
    : undefined;
  const tableRowKey = (row: Row) => String(instance.definition.getRowKey(row));
  const coreSelectionKeys = useMemo(() => {
    const entries = new Map<string, string | number>();
    const stateKeys =
      selection.mode === 'explicit' ? selection.selectedKeys : selection.excludedKeys;
    stateKeys.forEach((key) => entries.set(String(key), key));
    data.rows.forEach((row) => {
      const key = instance.definition.getRowKey(row);
      entries.set(String(key), key);
    });
    return entries;
  }, [data.rows, instance, selection]);
  usePublishGridSelectionMode(instance, selectionMode);
  useEffect(() => {
    if (selectionMode !== 'radio') return;
    if (selection.mode === 'allMatching') {
      instance.selection.clear();
      return;
    }
    if (selection.selectedKeys.length > 1) {
      const key = selection.selectedKeys[0];
      if (key === undefined) return;
      const selectedRow = data.rows.find(
        (row) => String(instance.definition.getRowKey(row)) === String(key),
      );
      instance.selection.set([key], selectedRow ? [selectedRow] : []);
    }
  }, [data.rows, instance, selection, selectionMode]);
  const selectionConfig: TableProps<Row>['rowSelection'] = uiSelection
    ? {
        ...(suppliedSelection || {}),
        fixed: suppliedSelection?.fixed ?? true,
        preserveSelectedRowKeys: true,
        selectedRowKeys:
          suppliedSelection?.type === 'radio'
            ? selection.mode === 'explicit'
              ? selection.selectedKeys.slice(0, 1).map(String)
              : []
            : selection.mode === 'explicit'
              ? selection.selectedKeys.map(String)
              : data.rows
                  .map(instance.definition.getRowKey)
                  .filter((key) => instance.selection.isSelected(key))
                  .map(String),
        onSelect: (row, selected, selectedRows, nativeEvent) => {
          suppliedSelection?.onSelect?.(row, selected, selectedRows, nativeEvent);
        },
        onSelectAll: (selected, selectedRows, changeRows) => {
          suppliedSelection?.onSelectAll?.(selected, selectedRows, changeRows);
        },
        onSelectMultiple: (selected, selectedRows, changeRows) => {
          suppliedSelection?.onSelectMultiple?.(selected, selectedRows, changeRows);
        },
        onChange: (selectedRowKeys, selectedRows, info) => {
          const validKeys = selectedRowKeys
            .filter(
              (key): key is string | number => typeof key === 'string' || typeof key === 'number',
            )
            .map((key) => coreSelectionKeys.get(String(key)) ?? String(key));
          const knownRows = selectedRows.filter((row): row is Row => Boolean(row));
          instance.selection.set(validKeys, knownRows);
          suppliedSelection?.onChange?.(selectedRowKeys, selectedRows, info);
        },
      }
    : undefined;
  const naturalWidth = leafColumns(orderedColumns(definitionColumns, columnState)).reduce(
    (total, column) =>
      total +
      ((instance.definition.columnMap.has(column.id) ? columnState.widths[column.id] : undefined) ||
        column.width ||
        160),
    (uiSelection ? parsePixelWidth(suppliedSelection?.columnWidth, 40) : 0) +
      (hasRowActions && rowActionConfig ? rowActionConfig.width || 132 : 0),
  );
  const size =
    columnState.density === 'compact'
      ? 'small'
      : columnState.density === 'comfortable'
        ? 'large'
        : 'middle';
  const filtered = Boolean(keyword || countFilterConditions(filters));
  const emptyText = ui.renderEmpty
    ? ui.renderEmpty({ filtered, instance })
    : filtered
      ? locale.noResults
      : locale.noData;
  const onChange: TableProps<Row>['onChange'] = (pagination, tableFilters, sorter, extra) => {
    tableProps.onChange?.(pagination, tableFilters, sorter, extra);
    const values = (Array.isArray(sorter) ? sorter : [sorter]) as SorterResult<Row>[];
    const rawSorts = values
      .filter((item) => item.order && typeof item.columnKey === 'string')
      .flatMap((item) => {
        const column = effectiveColumnMap.get(String(item.columnKey));
        const field = column?.fieldId
          ? instance.definition.fieldMap.get(column.fieldId)
          : undefined;
        if (!field?.sort) return [];
        const fieldId = field.id;
        const previous = sorts.find((sort) => sort.fieldId === fieldId);
        return [
          {
            id: previous?.id || createGridId('sort'),
            fieldId,
            direction: item.order === 'ascend' ? ('asc' as const) : ('desc' as const),
            ...(instance.capabilities.sort.nulls && field.sort.nulls !== false && previous?.nulls
              ? { nulls: previous.nulls }
              : {}),
          },
        ];
      });
    const rawByField = new Map(rawSorts.map((sort) => [sort.fieldId, sort]));
    const nextSorts: GridSort[] = sorts
      .filter((sort) => rawByField.has(sort.fieldId))
      .map((sort) => ({ ...sort, ...rawByField.get(sort.fieldId), id: sort.id }));
    rawSorts.forEach((sort) => {
      if (!nextSorts.some((current) => current.fieldId === sort.fieldId)) nextSorts.push(sort);
    });
    const addedFieldIds = new Set(
      rawSorts
        .filter((sort) => !sorts.some((current) => current.fieldId === sort.fieldId))
        .map((sort) => sort.fieldId),
    );
    const limitedSorts = addedFieldIds.size
      ? [
          ...nextSorts
            .filter((sort) => !addedFieldIds.has(sort.fieldId))
            .slice(0, Math.max(0, maximumSorts - addedFieldIds.size)),
          ...nextSorts.filter((sort) => addedFieldIds.has(sort.fieldId)),
        ].slice(0, maximumSorts)
      : nextSorts.slice(0, maximumSorts);
    if (stableSorts(limitedSorts) !== stableSorts(sorts))
      instance.query.setSorts(limitedSorts, 'user');
  };
  const onRow: TableProps<Row>['onRow'] = (row, rowIndex = 0) => {
    const suppliedRow = tableProps.onRow?.(row, rowIndex) || {};
    const context: GridRowInteractionContext<Row> = { row, rowIndex, instance };
    const clickable = Boolean(onRowClick && (isRowClickable ? isRowClickable(context) : true));
    return {
      ...suppliedRow,
      className: classes(suppliedRow.className, clickable && 'hui-grid__row--clickable'),
      tabIndex: suppliedRow.tabIndex ?? (clickable ? (rowIndex === 0 ? 0 : -1) : undefined),
      'data-grid-clickable-row': clickable ? 'true' : undefined,
      'aria-keyshortcuts': clickable ? 'Enter Space ArrowUp ArrowDown' : undefined,
      onClick: (event) => {
        suppliedRow.onClick?.(event);
        if (
          !event.defaultPrevented &&
          clickable &&
          !isInteractiveDescendant(event.target, event.currentTarget)
        ) {
          onRowClick?.({ ...context, event });
        }
      },
      onKeyDown: (event) => {
        suppliedRow.onKeyDown?.(event);
        if (
          !event.defaultPrevented &&
          clickable &&
          (event.key === 'Enter' || event.key === ' ') &&
          event.target === event.currentTarget
        ) {
          event.preventDefault();
          event.currentTarget.click();
        }
        if (
          !event.defaultPrevented &&
          clickable &&
          event.target === event.currentTarget &&
          (event.key === 'ArrowUp' || event.key === 'ArrowDown')
        ) {
          event.preventDefault();
          focusRowSibling(
            event.currentTarget,
            event.key === 'ArrowUp' ? -1 : 1,
            '[data-grid-clickable-row="true"]',
            false,
          );
        }
      },
    };
  };

  return (
    <div ref={wrapRef} className={['hui-grid__table-wrap', className].filter(Boolean).join(' ')}>
      <div ref={guideRef} className="hui-grid__resize-guide" hidden />
      <Table<Row>
        {...tableProps}
        columns={columns}
        dataSource={data.rows}
        rowKey={tableRowKey}
        rowSelection={selectionConfig}
        loading={
          loading === 'never'
            ? false
            : loading === 'initial'
              ? data.status === 'loading'
              : data.fetching
        }
        pagination={false}
        size={size}
        bordered={tableProps.bordered ?? true}
        sticky={tableProps.sticky ?? true}
        scroll={{ x: naturalWidth, ...tableProps.scroll }}
        locale={{ ...tableProps.locale, emptyText }}
        onRow={onRow}
        onChange={onChange}
      />
    </div>
  );
}

function stableSorts(sorts: GridSort[]): string {
  return JSON.stringify(sorts.map(({ fieldId, direction, nulls }) => [fieldId, direction, nulls]));
}
