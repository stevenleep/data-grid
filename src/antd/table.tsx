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
import { useMemo, useRef, type ReactNode } from 'react';
import {
  countFilterConditions,
  createGridId,
  type GridColumnState,
  type GridResolvedColumn,
  type GridSort,
} from '../core';
import { useGridInstance, useGridSelector } from '../react';
import { GridActions } from './actions';
import { GridCell, GridEditableCell } from './cells';
import { useGridUi } from './context';
import { resolveGridLocale } from './locale';
import type {
  GridCellClickContext,
  GridCellInteractionContext,
  GridRowClickContext,
  GridRowInteractionContext,
  GridRowActionsConfig,
  GridTablePlatformProps,
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

const defaultRowActions: NonNullable<GridTableProps<object>['rowActions']> = {};

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
  selection?: boolean | NonNullable<TableProps<Row>['rowSelection']>;
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

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        'a, button, input, select, textarea, [role="button"], [role="checkbox"], [role="menuitem"], [contenteditable="true"]',
      ),
    )
  );
}

export function GridTable<Row extends object>({
  columns: supplied,
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const tableProps = { ...ui.tableProps, ...localTableProps } as TableProps<Row>;
  const onRowClick = localOnRowClick || ui.onRowClick;
  const onCellClick = localOnCellClick || ui.onCellClick;
  const isRowClickable = localIsRowClickable || ui.isRowClickable;
  const isCellClickable = localIsCellClickable || ui.isCellClickable;
  const definitionColumns = supplied || instance.definition.columns;
  const rowActionConfig = rowActions === false ? undefined : rowActions;
  const hasRowActions = Boolean(
    rowActionConfig &&
    instance.definition.actions?.some((action) => (action.placement || 'toolbar') === 'row'),
  );

  const startResize = (
    event: React.PointerEvent,
    column: GridResolvedColumn<Row>,
    width: number,
  ) => {
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
    const finish = (upEvent: PointerEvent) => {
      document.body.style.cursor = bodyCursor;
      if (guideRef.current) guideRef.current.hidden = true;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      instance.columns.setWidth(column.id, width + upEvent.clientX - startX);
    };
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
            ? (column.header(column, instance) as ReactNode)
            : (column.title as ReactNode),
          children: column.children.map(build),
        };
      }
      const field = column.fieldId ? instance.definition.fieldMap.get(column.fieldId) : undefined;
      const width = columnState.widths[column.id] || column.width || 160;
      const pinned = Object.prototype.hasOwnProperty.call(columnState.pinned, column.id)
        ? columnState.pinned[column.id] || undefined
        : column.fixed;
      const activeSort = field ? sorts.find((sort) => sort.fieldId === field.id) : undefined;
      const platform = (column.platform || {}) as ColumnType<Row>;
      return {
        ...platform,
        key: column.id,
        width,
        fixed: pinned,
        align: column.align,
        ellipsis: column.ellipsis ?? !column.wrap,
        title: column.header ? (
          (column.header(column, instance) as ReactNode)
        ) : (
          <div className="hui-grid__column-title">
            {field && <span className="hui-grid__column-icon">{fieldIcon(field.valueType)}</span>}
            <Tooltip title={column.description as ReactNode}>
              <span className="hui-grid__column-label">{column.title as ReactNode}</span>
            </Tooltip>
            {column.resizable !== false && (
              <span
                className="hui-grid__resize-handle"
                role="separator"
                tabIndex={0}
                aria-orientation="vertical"
                aria-label={locale.resizeColumn(String(column.title))}
                onPointerDown={(event) => startResize(event, column, width)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft') instance.columns.setWidth(column.id, width - 10);
                  if (event.key === 'ArrowRight') instance.columns.setWidth(column.id, width + 10);
                }}
              />
            )}
          </div>
        ),
        sorter: field?.sort
          ? instance.capabilities.sort.max > 1
            ? {
                multiple: Math.max(
                  1,
                  instance.capabilities.sort.max - instance.definition.fields.indexOf(field),
                ),
              }
            : true
          : undefined,
        sortOrder: activeSort ? (activeSort.direction === 'asc' ? 'ascend' : 'descend') : undefined,
        render: (_value: unknown, row: Row, rowIndex: number) => {
          const value = field?.getValue(row);
          const content = column.render ? (
            (column.render({ value, row, rowIndex, column, field, instance }) as ReactNode)
          ) : field ? (
            <GridCell row={row} rowIndex={rowIndex} field={field} />
          ) : null;
          return field?.edit && instance.definition.editing ? (
            <GridEditableCell row={row} rowIndex={rowIndex} field={field}>
              {content}
            </GridEditableCell>
          ) : (
            content
          );
        },
        onCell: (row: Row, rowIndex = 0) => {
          const suppliedCell = platform.onCell?.(row, rowIndex) || {};
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
          return {
            ...suppliedCell,
            className: classes(suppliedCell.className, clickable && 'hui-grid__cell--clickable'),
            onClick: (event) => {
              suppliedCell.onClick?.(event);
              if (!event.defaultPrevented && clickable) onCellClick?.({ ...context, event });
            },
          };
        },
        shouldCellUpdate:
          platform.shouldCellUpdate ||
          ((next: Row, previous: Row) => {
            if (!field) return next !== previous;
            return !field.equals(field.getValue(next), field.getValue(previous));
          }),
      };
    };
    const result = nodes.map(build);
    if (hasRowActions && rowActionConfig) {
      result.push({
        key: '__grid_actions',
        title: rowActionConfig.title || locale.actions,
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
    onCellClick,
    rowActionConfig,
    sorts,
  ]);

  const uiSelection = selectionOverride ?? ui.selection ?? instance.definition.defaults?.selection;
  const selectionConfig: TableProps<Row>['rowSelection'] = uiSelection
    ? {
        ...(typeof uiSelection === 'object' ? uiSelection : {}),
        fixed: typeof uiSelection === 'object' ? (uiSelection.fixed ?? true) : true,
        preserveSelectedRowKeys: true,
        selectedRowKeys:
          selection.mode === 'explicit'
            ? selection.selectedKeys
            : data.rows
                .map(instance.definition.getRowKey)
                .filter((key) => !selection.excludedKeys.includes(key)),
        onSelect: (row, selected) =>
          instance.selection.toggle(instance.definition.getRowKey(row), row, selected),
        onSelectAll: (selected, _selectedRows, changeRows) => {
          changeRows.forEach((row) =>
            instance.selection.toggle(instance.definition.getRowKey(row), row, selected),
          );
        },
      }
    : undefined;
  const naturalWidth = leafColumns(orderedColumns(definitionColumns, columnState)).reduce(
    (total, column) => total + (columnState.widths[column.id] || column.width || 160),
    (uiSelection ? 40 : 0) + (hasRowActions && rowActionConfig ? rowActionConfig.width || 132 : 0),
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
    const nextSorts = values
      .filter((item) => item.order && typeof item.columnKey === 'string')
      .slice(0, instance.capabilities.sort.max)
      .map((item) => {
        const column = instance.definition.columnMap.get(String(item.columnKey));
        const fieldId = column?.fieldId || String(item.columnKey);
        const previous = sorts.find((sort) => sort.fieldId === fieldId);
        return {
          id: previous?.id || createGridId('sort'),
          fieldId,
          direction: item.order === 'ascend' ? ('asc' as const) : ('desc' as const),
          ...(previous?.nulls ? { nulls: previous.nulls } : {}),
        };
      });
    if (stableSorts(nextSorts) !== stableSorts(sorts)) instance.query.setSorts(nextSorts, 'user');
  };
  const onRow: TableProps<Row>['onRow'] = (row, rowIndex = 0) => {
    const suppliedRow = tableProps.onRow?.(row, rowIndex) || {};
    const context: GridRowInteractionContext<Row> = { row, rowIndex, instance };
    const clickable = Boolean(onRowClick && (isRowClickable ? isRowClickable(context) : true));
    return {
      ...suppliedRow,
      className: classes(suppliedRow.className, clickable && 'hui-grid__row--clickable'),
      onClick: (event) => {
        suppliedRow.onClick?.(event);
        if (!event.defaultPrevented && clickable && !isInteractiveTarget(event.target)) {
          onRowClick?.({ ...context, event });
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
        rowKey={instance.definition.getRowKey}
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
