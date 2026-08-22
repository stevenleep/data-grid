import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  PushpinOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Button, Checkbox, Dropdown, Input, Popover, Space, Tooltip } from 'antd';
import { useMemo, useState, type ReactNode } from 'react';
import type { GridColumnState, GridResolvedColumn } from '../core';
import { useGridInstance, useGridSelector } from '../react';
import { useGridUi } from './context';
import { useControllableOpen } from './hooks';
import { resolveGridLocale } from './locale';

function leafColumns<Row extends object>(
  columns: readonly GridResolvedColumn<Row>[],
): GridResolvedColumn<Row>[] {
  return columns.flatMap((column) =>
    column.children?.length ? leafColumns(column.children) : [column],
  );
}

export interface GridColumnPanelProps<Row extends object> {
  state?: GridColumnState;
  onChange?: (state: GridColumnState) => void;
  columns?: GridResolvedColumn<Row>[];
}

export function GridColumnPanel<Row extends object>({
  state: controlled,
  onChange,
  columns: supplied,
}: GridColumnPanelProps<Row> = {}) {
  const instance = useGridInstance<Row>();
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  const current = useGridSelector<Row, GridColumnState>((state) => state.columns);
  const state = controlled || current;
  const [search, setSearch] = useState('');
  const columns = useMemo(
    () => leafColumns(supplied || instance.definition.columns),
    [instance, supplied],
  );
  const ordered = useMemo(
    () =>
      [...columns]
        .sort((left, right) => state.order.indexOf(left.id) - state.order.indexOf(right.id))
        .filter((column) =>
          String(column.title).toLocaleLowerCase().includes(search.toLocaleLowerCase()),
        ),
    [columns, search, state.order],
  );
  const setVisible = (columnId: string, visible: boolean) => {
    if (!onChange) return instance.columns.setVisible(columnId, visible);
    const hidden = new Set(state.hidden);
    if (visible) hidden.delete(columnId);
    else hidden.add(columnId);
    onChange({ ...state, hidden: [...hidden] });
  };
  const setPinned = (columnId: string, pinned: 'left' | 'right' | null) => {
    if (!onChange) return instance.columns.setPinned(columnId, pinned);
    onChange({ ...state, pinned: { ...state.pinned, [columnId]: pinned } });
  };
  const move = (columnId: string, direction: -1 | 1) => {
    const order = [...state.order];
    const index = order.indexOf(columnId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target]!, order[index]!];
    if (onChange) onChange({ ...state, order });
    else instance.columns.setOrder(order);
  };
  const reset = () => {
    if (onChange) onChange(instance.columns.getDefaultState());
    else instance.columns.reset();
  };

  return (
    <div className="hui-grid__panel hui-grid__column-panel">
      <div className="hui-grid__panel-heading">
        <strong>{locale.fields}</strong>
        <Button size="small" type="link" onClick={reset}>
          {locale.reset}
        </Button>
      </div>
      <Input.Search
        size="small"
        allowClear
        value={search}
        placeholder={locale.fieldSearch}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="hui-grid__column-list">
        {ordered.map((column) => {
          const hidden = state.hidden.includes(column.id);
          const pinned = state.pinned[column.id] ?? null;
          const position = state.order.indexOf(column.id);
          return (
            <div className="hui-grid__column-item" key={column.id}>
              <Tooltip title={hidden ? locale.showColumn : locale.hideColumn}>
                <Checkbox
                  checked={!hidden}
                  disabled={column.hideable === false}
                  onChange={(event) => setVisible(column.id, event.target.checked)}
                />
              </Tooltip>
              <span className="hui-grid__column-label">{column.title as ReactNode}</span>
              <Space.Compact>
                <Dropdown
                  menu={{
                    selectedKeys: pinned ? [pinned] : [],
                    items: [
                      { key: 'left', label: locale.pinLeft },
                      { key: 'right', label: locale.pinRight },
                      { key: 'none', label: locale.unpin },
                    ],
                    onClick: ({ key }) =>
                      setPinned(column.id, key === 'none' ? null : (key as 'left' | 'right')),
                  }}
                  disabled={column.pinnable === false}
                >
                  <Button
                    size="small"
                    type={pinned ? 'default' : 'text'}
                    icon={<PushpinOutlined />}
                  />
                </Dropdown>
                <Button
                  size="small"
                  type="text"
                  disabled={position <= 0 || column.reorderable === false}
                  aria-label={locale.moveUp}
                  icon={<ArrowUpOutlined />}
                  onClick={() => move(column.id, -1)}
                />
                <Button
                  size="small"
                  type="text"
                  disabled={position >= state.order.length - 1 || column.reorderable === false}
                  aria-label={locale.moveDown}
                  icon={<ArrowDownOutlined />}
                  onClick={() => move(column.id, 1)}
                />
              </Space.Compact>
            </div>
          );
        })}
        {!ordered.length && <div className="hui-grid__panel-empty">{locale.noFields}</div>}
      </div>
    </div>
  );
}

export interface GridColumnTriggerProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode | ((context: { open: boolean }) => ReactNode);
  placement?: 'bottomLeft' | 'bottomRight' | 'topLeft' | 'topRight';
}

export function GridColumnTrigger<Row extends object>({
  open: controlled,
  defaultOpen = false,
  onOpenChange,
  trigger,
  placement = 'bottomLeft',
}: GridColumnTriggerProps = {}) {
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  const [open, setOpen] = useControllableOpen(controlled, defaultOpen, onOpenChange);
  const button =
    typeof trigger === 'function'
      ? trigger({ open })
      : trigger || (
          <Button size="small" type="text" icon={<SettingOutlined />}>
            {locale.fields}
          </Button>
        );
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement={placement}
      destroyOnHidden
      content={<GridColumnPanel<Row> />}
    >
      <span>{button}</span>
    </Popover>
  );
}
