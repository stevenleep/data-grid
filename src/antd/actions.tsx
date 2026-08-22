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
  GridResolvedField,
} from '../core';
import { useGridInstance, useGridSelector } from '../react';
import { useGridUi } from './context';
import { resolveGridLocale } from './locale';

function actionStateEqual(
  left: { loading: boolean; error?: string },
  right: { loading: boolean; error?: string },
) {
  return left.loading === right.loading && left.error === right.error;
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
  const state = useGridSelector(
    (current) => ({
      loading: Boolean(current.actions.pending[key]),
      error: current.actions.errors[key],
    }),
    actionStateEqual,
  );
  const context = instance.actions.getContext(row, field, value);
  const visible =
    typeof action.visible === 'function' ? action.visible(context) : action.visible !== false;
  const disabled =
    Boolean(typeof action.disabled === 'function' ? action.disabled(context) : action.disabled) ||
    state.loading;
  const run = async () => {
    try {
      await instance.actions.run(action, { row, field, value });
    } catch {
      // The shared action state and onError callback expose the failure.
    }
  };
  if (!visible) return null;
  if (render) return render({ action, ...state, disabled, run });

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
      icon={action.icon as ReactNode}
      onClick={requiresConfirmation ? undefined : () => void run()}
    >
      {action.label as ReactNode}
    </Button>
  );
  const wrapped = requiresConfirmation ? (
    <Popconfirm
      title={content as ReactNode}
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
  useGridSelector<Row, ReturnType<typeof instance.getState>['query']>((state) => state.query);
  useGridSelector<Row, ReturnType<typeof instance.getState>['selection']>(
    (state) => state.selection,
  );
  useGridSelector<Row, readonly Row[]>((state) => state.data.rows);
  const actionState = useGridSelector<Row, ReturnType<typeof instance.getState>['actions']>(
    (state) => state.actions,
  );
  const baseContext = instance.actions.getContext(row, field, value);
  const resolved = (actions || instance.actions.list(placement, row)).filter((action) =>
    typeof action.visible === 'function' ? action.visible(baseContext) : action.visible !== false,
  );
  const visible = resolved.slice(0, maxVisible);
  const overflow = resolved.slice(maxVisible);

  const items = useMemo(
    () =>
      overflow.map((action) => {
        const disabled =
          Boolean(
            typeof action.disabled === 'function' ? action.disabled(baseContext) : action.disabled,
          ) || Boolean(actionState.pending[instance.actions.key(action.id, row)]);
        return {
          key: action.id,
          label: action.label as ReactNode,
          icon: action.icon as ReactNode,
          danger: action.intent === 'danger',
          disabled,
          onClick: () => {
            const run = () => instance.actions.run(action, { row, field, value }).catch(() => {});
            const confirm = action.getConfirmation
              ? action.getConfirmation(baseContext)
              : typeof action.confirm === 'function'
                ? action.confirm(baseContext)
                : action.confirm;
            if (confirm) {
              modal.confirm({
                title: confirm as ReactNode,
                okButtonProps: { danger: action.intent === 'danger' },
                onOk: run,
              });
            } else void run();
          },
        };
      }),
    [actionState.pending, baseContext, field, instance, modal, overflow, row, value],
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
          row={row}
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
