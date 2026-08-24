import { MoreOutlined } from '@ant-design/icons';
import {
  App as AntApp,
  Button,
  Dropdown,
  Popconfirm,
  Space,
  Tooltip,
  type ButtonProps,
} from 'antd';
import { useMemo, type ReactNode } from 'react';
import type {
  GridAction,
  GridActionContext,
  GridActionPlacement,
  GridInstance,
  GridResolvedField,
  GridRowKey,
} from '../core';
import { useGridInstance, useGridSelector } from '../react';
import { useGridUi } from './context';
import { resolveGridLocale } from './locale';
import { gridNodeText, renderGridNode } from './render';

const rowIndexes = new WeakMap<readonly object[], Map<GridRowKey, object>>();
const selectedRowIndexes = new WeakMap<
  object,
  { selection: unknown; rows: unknown; value: readonly object[] }
>();

function currentRowFrom<Row extends object>(
  rows: readonly Row[],
  key: GridRowKey | undefined,
  getRowKey: (row: Row) => GridRowKey,
): Row | undefined {
  if (key === undefined) return undefined;
  let index = rowIndexes.get(rows) as Map<GridRowKey, Row> | undefined;
  if (!index) {
    index = new Map(rows.map((item) => [getRowKey(item), item]));
    rowIndexes.set(rows, index as Map<GridRowKey, object>);
  }
  return index.get(key);
}

function selectedRowsFrom<Row extends object>(
  instance: GridInstance<Row>,
  selection: unknown,
  rows: readonly Row[],
): readonly Row[] {
  const cached = selectedRowIndexes.get(instance);
  if (cached && cached.selection === selection && cached.rows === rows)
    return cached.value as readonly Row[];
  const resolved = instance.selection.getSelectedRows();
  let value: readonly object[] = resolved;
  if (cached) {
    const previous = cached.value;
    if (
      previous.length === resolved.length &&
      previous.every((item, index) => item === resolved[index])
    ) {
      value = previous;
    }
  }
  selectedRowIndexes.set(instance, { selection, rows, value });
  return value as readonly Row[];
}

function booleanRecordEqual(left: Record<string, boolean>, right: Record<string, boolean>) {
  const leftKeys = Object.keys(left);
  return (
    leftKeys.length === Object.keys(right).length &&
    leftKeys.every((key) => left[key] === right[key])
  );
}

function actionStateEqual<Row extends object>(
  left: {
    loading: boolean;
    error?: string;
    query: unknown;
    selection: unknown;
    selectedRows: unknown;
    row?: Row;
  },
  right: {
    loading: boolean;
    error?: string;
    query: unknown;
    selection: unknown;
    selectedRows: unknown;
    row?: Row;
  },
) {
  return (
    left.loading === right.loading &&
    left.error === right.error &&
    left.query === right.query &&
    left.selection === right.selection &&
    left.selectedRows === right.selectedRows &&
    left.row === right.row
  );
}

export interface GridActionButtonProps<Row extends object> {
  action: GridAction<Row>;
  row?: Row;
  field?: GridResolvedField<Row>;
  value?: unknown;
  compact?: boolean;
  buttonProps?: Omit<ButtonProps, 'onClick' | 'loading' | 'disabled' | 'danger'>;
  render?: (context: {
    action: GridAction<Row>;
    loading: boolean;
    disabled: boolean;
    error?: string;
    run: () => Promise<void>;
  }) => ReactNode;
}

export function GridActionButton<Row extends object>({
  action,
  row,
  field,
  value,
  compact,
  buttonProps,
  render,
}: GridActionButtonProps<Row>) {
  const instance = useGridInstance<Row>();
  const key = instance.actions.key(action.id, row);
  const rowKey = row ? instance.definition.getRowKey(row) : undefined;
  const state = useGridSelector<
    Row,
    {
      loading: boolean;
      error?: string;
      query: unknown;
      selection: unknown;
      selectedRows: readonly Row[];
      row?: Row;
    }
  >(
    (current) => ({
      loading: Boolean(current.actions.pending[key]),
      error: current.actions.errors[key],
      query: current.query,
      selection: current.selection,
      selectedRows: selectedRowsFrom(instance, current.selection, current.data.rows),
      row: currentRowFrom(current.data.rows, rowKey, instance.definition.getRowKey),
    }),
    actionStateEqual,
  );
  const currentRow = state.row || row;
  const context = instance.actions.getContext(currentRow, field, value);
  const visible =
    typeof action.visible === 'function' ? action.visible(context) : action.visible !== false;
  const disabled =
    Boolean(typeof action.disabled === 'function' ? action.disabled(context) : action.disabled) ||
    state.loading;
  const run = async () => {
    try {
      await instance.actions.run(action, { row: currentRow, field, value });
    } catch {
      // The shared action state and onError callback expose the failure.
    }
  };
  if (!visible) return null;
  if (render) {
    return render({
      action,
      loading: state.loading,
      error: state.error,
      disabled,
      run,
    });
  }

  const content = action.getConfirmation
    ? action.getConfirmation(context)
    : action.confirm
      ? typeof action.confirm === 'function'
        ? action.confirm(context)
        : action.confirm
      : undefined;
  const requiresConfirmation = content !== undefined && content !== null && content !== false;
  const button = (
    <Button
      {...buttonProps}
      size={buttonProps?.size || 'small'}
      type={
        buttonProps?.type || (action.intent === 'primary' ? 'primary' : compact ? 'link' : 'text')
      }
      danger={action.intent === 'danger'}
      disabled={disabled}
      loading={state.loading}
      icon={renderGridNode(action.icon)}
      aria-label={buttonProps?.['aria-label'] || gridNodeText(action.label) || action.id}
      onClick={requiresConfirmation ? undefined : () => void run()}
    >
      {renderGridNode(action.label)}
    </Button>
  );
  const wrapped = requiresConfirmation ? (
    <Popconfirm
      title={renderGridNode(content)}
      onConfirm={() => void run()}
      okButtonProps={{ danger: action.intent === 'danger' }}
    >
      {button}
    </Popconfirm>
  ) : (
    button
  );
  return state.error ? <Tooltip title={state.error}>{wrapped}</Tooltip> : wrapped;
}

export interface GridActionsProps<Row extends object> {
  placement: GridActionPlacement;
  row?: Row;
  field?: GridResolvedField<Row>;
  value?: unknown;
  actions?: readonly GridAction<Row>[];
  maxVisible?: number;
  compact?: boolean;
  className?: string;
}

export function GridActions<Row extends object>({
  placement,
  row,
  field,
  value,
  actions,
  maxVisible = placement === 'row' ? 1 : Number.MAX_SAFE_INTEGER,
  compact = placement === 'row',
  className,
}: GridActionsProps<Row>) {
  const instance = useGridInstance<Row>();
  const { modal } = AntApp.useApp();
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  const rowKey = row ? instance.definition.getRowKey(row) : undefined;
  const state = useGridSelector<
    Row,
    {
      query: ReturnType<typeof instance.getState>['query'];
      selection: ReturnType<typeof instance.getState>['selection'];
      selectedRows: readonly Row[];
      row?: Row;
    }
  >(
    (current) => ({
      query: current.query,
      selection: current.selection,
      selectedRows: selectedRowsFrom(instance, current.selection, current.data.rows),
      row: currentRowFrom(current.data.rows, rowKey, instance.definition.getRowKey),
    }),
    (left, right) =>
      left.query === right.query &&
      left.selection === right.selection &&
      left.selectedRows === right.selectedRows &&
      left.row === right.row,
  );
  const currentRow = state.row || row;
  const baseContext = instance.actions.getContext(currentRow, field, value);
  const candidates = actions
    ? [...actions]
    : (instance.definition.actions || [])
        .filter((action) => (action.placement || 'toolbar') === placement)
        .sort((left, right) => (left.order || 0) - (right.order || 0));
  const resolved = candidates.filter((action) =>
    typeof action.visible === 'function' ? action.visible(baseContext) : action.visible !== false,
  );
  const visible = resolved.slice(0, maxVisible);
  const overflow = resolved.slice(maxVisible);
  const pending = useGridSelector<Row, Record<string, boolean>>(
    (current) =>
      Object.fromEntries(
        overflow.map((action) => [
          action.id,
          Boolean(current.actions.pending[instance.actions.key(action.id, currentRow)]),
        ]),
      ),
    booleanRecordEqual,
  );

  const items = useMemo(
    () =>
      overflow.map((action) => {
        const disabled =
          Boolean(
            typeof action.disabled === 'function' ? action.disabled(baseContext) : action.disabled,
          ) || Boolean(pending[action.id]);
        return {
          key: action.id,
          label: renderGridNode(action.label),
          icon: renderGridNode(action.icon),
          danger: action.intent === 'danger',
          disabled,
          onClick: () => {
            const run = () =>
              instance.actions.run(action, { row: currentRow, field, value }).catch(() => {});
            const confirm = action.getConfirmation
              ? action.getConfirmation(baseContext)
              : typeof action.confirm === 'function'
                ? action.confirm(baseContext)
                : action.confirm;
            if (confirm) {
              modal.confirm({
                title: renderGridNode(confirm),
                okButtonProps: { danger: action.intent === 'danger' },
                onOk: run,
              });
            } else void run();
          },
        };
      }),
    [baseContext, currentRow, field, instance, modal, overflow, pending, value],
  );
  if (!resolved.length) return null;
  return (
    <Space
      className={className}
      size={2}
      wrap
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {visible.map((action) => (
        <GridActionButton
          key={action.id}
          action={action}
          row={currentRow}
          field={field}
          value={value}
          compact={compact}
        />
      ))}
      {items.length > 0 && (
        <Dropdown menu={{ items }} trigger={['click']}>
          <Button
            size="small"
            type={compact ? 'link' : 'text'}
            icon={<MoreOutlined />}
            aria-label={locale.more}
          >
            {compact ? null : locale.more}
          </Button>
        </Dropdown>
      )}
    </Space>
  );
}

export interface GridSelectionBarProps {
  children?: ReactNode;
}

export function GridSelectionBar<Row extends object>({ children }: GridSelectionBarProps = {}) {
  const instance = useGridInstance<Row>();
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  const selection = useGridSelector<Row, ReturnType<typeof instance.getState>['selection']>(
    (state) => state.selection,
  );
  const count =
    selection.mode === 'explicit'
      ? selection.selectedKeys.length
      : Math.max(0, selection.total - selection.excludedKeys.length);
  if (!count) return null;
  return (
    <div className="hui-grid__selection-bar">
      <span>{locale.selected(count)}</span>
      {children || <GridActions<Row> placement="bulk" />}
      <Button size="small" type="text" onClick={instance.selection.clear}>
        {locale.cancel}
      </Button>
    </div>
  );
}
