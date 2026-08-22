import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CloseOutlined,
  PlusOutlined,
  SortAscendingOutlined,
} from '@ant-design/icons';
import { Button, Divider, Popover, Select, Space } from 'antd';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createGridId, type GridResolvedField, type GridSort } from '../core';
import { useGridInstance, useGridSelector } from '../react';
import { useGridUi } from './context';
import { useControllableOpen } from './hooks';
import { resolveGridLocale } from './locale';

export interface GridSortBuilderProps<Row extends object> {
  value: GridSort[];
  onChange: (value: GridSort[]) => void;
  fields?: GridResolvedField<Row>[];
}

export function GridSortBuilder<Row extends object>({
  value,
  onChange,
  fields: supplied,
}: GridSortBuilderProps<Row>) {
  const instance = useGridInstance<Row>();
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  const fields = useMemo(
    () => supplied || instance.definition.fields.filter((field) => field.sort),
    [instance, supplied],
  );
  const maximum = instance.capabilities.sort.max;
  const available = fields.find((field) => !value.some((sort) => sort.fieldId === field.id));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length) return;
    const next = [...value];
    const [item] = next.splice(from, 1);
    if (!item) return;
    next.splice(to, 0, item);
    onChange(next);
  };

  return (
    <div className="hui-grid__sort-rules">
      {value.map((sort, index) => {
        const field = instance.definition.fieldMap.get(sort.fieldId);
        return (
          <div className="hui-grid__sort-rule" key={sort.id}>
            <Select
              size="small"
              value={sort.fieldId}
              options={fields.map((item) => ({
                label: item.title as ReactNode,
                value: item.id,
                disabled:
                  item.id !== sort.fieldId && value.some((current) => current.fieldId === item.id),
              }))}
              onChange={(fieldId) =>
                onChange(
                  value.map((current, currentIndex) =>
                    currentIndex === index ? { ...current, fieldId } : current,
                  ),
                )
              }
            />
            <Select
              size="small"
              value={sort.direction}
              options={[
                { label: locale.sortAscending, value: 'asc' },
                { label: locale.sortDescending, value: 'desc' },
              ]}
              onChange={(direction) =>
                onChange(
                  value.map((current, currentIndex) =>
                    currentIndex === index ? { ...current, direction } : current,
                  ),
                )
              }
            />
            {instance.capabilities.sort.nulls && field?.sort && field.sort.nulls !== false && (
              <Select
                size="small"
                value={sort.nulls || 'last'}
                options={[
                  { label: locale.nullsLast, value: 'last' },
                  { label: locale.nullsFirst, value: 'first' },
                ]}
                onChange={(nulls) =>
                  onChange(
                    value.map((current, currentIndex) =>
                      currentIndex === index ? { ...current, nulls } : current,
                    ),
                  )
                }
              />
            )}
            <Space.Compact>
              <Button
                size="small"
                type="text"
                disabled={!index}
                aria-label={locale.moveUp}
                icon={<ArrowUpOutlined />}
                onClick={() => move(index, index - 1)}
              />
              <Button
                size="small"
                type="text"
                disabled={index === value.length - 1}
                aria-label={locale.moveDown}
                icon={<ArrowDownOutlined />}
                onClick={() => move(index, index + 1)}
              />
              <Button
                size="small"
                type="text"
                danger
                aria-label={locale.remove}
                icon={<CloseOutlined />}
                onClick={() => onChange(value.filter((_, currentIndex) => currentIndex !== index))}
              />
            </Space.Compact>
          </div>
        );
      })}
      {!value.length && <div className="hui-grid__panel-empty">{locale.noSorts}</div>}
      {available && value.length < maximum && (
        <Button
          size="small"
          type="text"
          icon={<PlusOutlined />}
          onClick={() =>
            onChange([
              ...value,
              {
                id: createGridId('sort'),
                fieldId: available.id,
                direction: available.sort ? available.sort.defaultDirection || 'asc' : 'asc',
                ...(instance.capabilities.sort.nulls ? { nulls: 'last' as const } : {}),
              },
            ])
          }
        >
          {locale.addSort}
        </Button>
      )}
    </div>
  );
}

export interface GridSortPanelProps<Row extends object> extends GridSortBuilderProps<Row> {
  onApply?: (value: GridSort[]) => void;
  onClear?: () => void;
  onCancel?: () => void;
}

export function GridSortPanel<Row extends object>({
  value,
  onChange,
  onApply,
  onClear,
  onCancel,
  fields,
}: GridSortPanelProps<Row>) {
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  return (
    <div className="hui-grid__panel hui-grid__sort-panel">
      <GridSortBuilder value={value} onChange={onChange} fields={fields} />
      <Divider />
      <div className="hui-grid__panel-footer">
        {onCancel && (
          <Button size="small" onClick={onCancel}>
            {locale.cancel}
          </Button>
        )}
        <Button size="small" onClick={onClear}>
          {locale.clear}
        </Button>
        <Button size="small" type="primary" onClick={() => onApply?.(value)}>
          {locale.apply}
        </Button>
      </div>
    </div>
  );
}

export interface GridSortTriggerProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode | ((context: { open: boolean; count: number }) => ReactNode);
  placement?: 'bottomLeft' | 'bottomRight' | 'topLeft' | 'topRight';
}

export function GridSortTrigger<Row extends object>({
  open: controlled,
  defaultOpen = false,
  onOpenChange,
  trigger,
  placement = 'bottomLeft',
}: GridSortTriggerProps = {}) {
  const instance = useGridInstance<Row>();
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  const sorts = useGridSelector<Row, GridSort[]>((state) => state.query.sorts);
  const [open, setOpen] = useControllableOpen(controlled, defaultOpen, onOpenChange);
  const [draft, setDraft] = useState(() => sorts.map((sort) => ({ ...sort })));
  useEffect(() => {
    if (open) setDraft(sorts.map((sort) => ({ ...sort })));
  }, [open, sorts]);

  const button =
    typeof trigger === 'function'
      ? trigger({ open, count: sorts.length })
      : trigger || (
          <Button
            size="small"
            type={sorts.length ? 'default' : 'text'}
            icon={<SortAscendingOutlined />}
          >
            {locale.sorts}
            {sorts.length ? ` ${sorts.length}` : ''}
          </Button>
        );
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement={placement}
      destroyOnHidden
      content={
        <GridSortPanel
          value={draft}
          onChange={setDraft}
          onCancel={() => setOpen(false)}
          onClear={() => {
            setDraft([]);
            instance.query.setSorts([], 'user');
            setOpen(false);
          }}
          onApply={(value) => {
            instance.query.setSorts(value, 'user');
            setOpen(false);
          }}
        />
      }
    >
      <span>{button}</span>
    </Popover>
  );
}
