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
import { gridNodeText, renderGridNode } from './render';

interface LeafColumnEntry<Row extends object> {
  column: GridResolvedColumn<Row>;
  parent?: GridResolvedColumn<Row>;
}

function leafColumnEntries<Row extends object>(
  columns: readonly GridResolvedColumn<Row>[],
  parent?: GridResolvedColumn<Row>,
): LeafColumnEntry<Row>[] {
  return columns.flatMap((column) =>
    column.children?.length ? leafColumnEntries(column.children, column) : [{ column, parent }],
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
  const state = controlled ?? current;
  const readOnly = controlled !== undefined && !onChange;
  const [search, setSearch] = useState('');
  const entries = useMemo(
    () => leafColumnEntries(supplied || instance.definition.columns),
    [instance, instance.definition.columns, supplied],
  );
  const columns = useMemo(() => entries.map((entry) => entry.column), [entries]);
  const entryMap = useMemo(
    () => new Map(entries.map((entry) => [entry.column.id, entry])),
    [entries],
  );
  const order = useMemo(
    () => [
      ...state.order.filter((id) => columns.some((column) => column.id === id)),
      ...columns.map((column) => column.id).filter((id) => !state.order.includes(id)),
    ],
    [columns, state.order],
  );
  const ordered = useMemo(
    () =>
      [...columns]
        .sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id))
        .filter((column) =>
          gridNodeText(column.title).toLocaleLowerCase().includes(search.toLocaleLowerCase()),
        ),
    [columns, order, search],
  );
  const setVisible = (columnId: string, visible: boolean) => {
    if (readOnly) return;
    const hidden = new Set(state.hidden);
    if (visible) hidden.delete(columnId);
    else hidden.add(columnId);
    if (controlled === undefined) {
      instance.columns.setVisible(columnId, visible);
      onChange?.(instance.getState().columns);
      return;
    }
    onChange?.({ ...state, hidden: [...hidden] });
  };
  const setPinned = (columnId: string, pinned: 'left' | 'right' | null) => {
    if (readOnly) return;
    if (controlled === undefined) {
      instance.columns.setPinned(columnId, pinned);
      onChange?.(instance.getState().columns);
      return;
    }
    onChange?.({ ...state, pinned: { ...state.pinned, [columnId]: pinned } });
  };
  const move = (columnId: string, direction: -1 | 1) => {
    const entry = entryMap.get(columnId);
    if (!entry || entry.column.reorderable === false) return;
    const siblings = order.filter((id) => entryMap.get(id)?.parent === entry.parent);
    const siblingIndex = siblings.indexOf(columnId);
    const targetId = siblings[siblingIndex + direction];
    const targetEntry = targetId ? entryMap.get(targetId) : undefined;
    if (!targetId || targetEntry?.column.reorderable === false) return;
    const nextOrder = [...order];
    const index = nextOrder.indexOf(columnId);
    const target = nextOrder.indexOf(targetId);
    if (index < 0 || target < 0) return;
    [nextOrder[index], nextOrder[target]] = [nextOrder[target]!, nextOrder[index]!];
    if (readOnly) return;
    if (controlled === undefined) {
      instance.columns.setOrder(nextOrder);
      onChange?.(instance.getState().columns);
    } else onChange?.({ ...state, order: nextOrder });
  };
  const reset = () => {
    if (readOnly) return;
    if (controlled === undefined) {
      instance.columns.reset();
      onChange?.(instance.getState().columns);
    } else onChange?.(instance.columns.getDefaultState());
  };

  return (
    <div className="hui-grid__panel hui-grid__column-panel">
      <div className="hui-grid__panel-heading">
        <strong>{locale.fields}</strong>
        <Button size="small" type="link" disabled={readOnly} onClick={reset}>
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
          const managed = Boolean(
            !readOnly &&
            (controlled !== undefined ? onChange : instance.definition.columnMap.has(column.id)),
          );
          const hidden = state.hidden.includes(column.id);
          const pinned = state.pinned[column.id] ?? null;
          const entry = entryMap.get(column.id);
          const siblings = entry
            ? order.filter((id) => entryMap.get(id)?.parent === entry.parent)
            : [];
          const position = siblings.indexOf(column.id);
          const previousColumn = entryMap.get(siblings[position - 1] || '')?.column;
          const nextColumn = entryMap.get(siblings[position + 1] || '')?.column;
          const title = gridNodeText(column.title) || column.id;
          return (
            <div className="hui-grid__column-item" key={column.id}>
              <Tooltip title={hidden ? locale.showColumn : locale.hideColumn}>
                <Checkbox
                  checked={!hidden}
                  disabled={!managed || column.hideable === false}
                  aria-label={`${hidden ? locale.showColumn : locale.hideColumn}: ${title}`}
                  onChange={(event) => setVisible(column.id, event.target.checked)}
                />
              </Tooltip>
              <span className="hui-grid__column-label">{renderGridNode(column.title)}</span>
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
                  disabled={!managed || column.pinnable === false}
                >
                  <Button
                    size="small"
                    type={pinned ? 'default' : 'text'}
                    icon={<PushpinOutlined />}
                    aria-label={`${pinned ? locale.unpin : `${locale.pinLeft}/${locale.pinRight}`}: ${title}`}
                  />
                </Dropdown>
                <Button
                  size="small"
                  type="text"
                  disabled={
                    !managed ||
                    position <= 0 ||
                    column.reorderable === false ||
                    previousColumn?.reorderable === false
                  }
                  aria-label={locale.moveUp}
                  icon={<ArrowUpOutlined />}
                  onClick={() => move(column.id, -1)}
                />
                <Button
                  size="small"
                  type="text"
                  disabled={
                    !managed ||
                    position >= siblings.length - 1 ||
                    column.reorderable === false ||
                    nextColumn?.reorderable === false
                  }
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
      : (trigger ?? (
          <Button size="small" type="text" icon={<SettingOutlined />}>
            {locale.fields}
          </Button>
        ));
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
