import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CloseOutlined,
  PlusOutlined,
  SortAscendingOutlined,
} from '@ant-design/icons';
import { Alert, Button, Divider, Popover, Select, Space } from 'antd';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { type GridResolvedCapabilities, type GridResolvedField, type GridSort } from '../core';
import { createGridId } from '../core/model';
import { useGridInstance, useGridSelector } from '../react';
import { useGridUi } from './context';
import { useControllableOpen } from './hooks';
import { resolveGridLocale } from './locale';
import { gridNodeText, renderGridNode } from './render';

function supportsNullPlacement<Row extends object>(
  field: GridResolvedField<Row> | undefined,
  sourceSupportsNulls: boolean,
): boolean {
  return Boolean(sourceSupportsNulls && field?.sort && field.sort.nulls !== false);
}

function sortCapabilityConflict<Row extends object>(
  sorts: GridSort[],
  fields: readonly GridResolvedField<Row>[],
  capabilities: GridResolvedCapabilities['sort'],
): boolean {
  if (sorts.length > capabilities.max) return true;
  const fieldMap = new Map(fields.map((field) => [field.id, field]));
  const seen = new Set<string>();
  const ids = new Set<string>();
  return sorts.some((sort) => {
    const field = fieldMap.get(sort.fieldId);
    if (!sort.id || ids.has(sort.id) || !field?.sort || seen.has(sort.fieldId)) return true;
    ids.add(sort.id);
    seen.add(sort.fieldId);
    return false;
  });
}

function normalizeSortNulls<Row extends object>(
  sorts: GridSort[],
  fields: readonly GridResolvedField<Row>[],
  sourceSupportsNulls: boolean,
): GridSort[] {
  const fieldMap = new Map(fields.map((field) => [field.id, field]));
  return sorts.map((sort) => {
    const field = fieldMap.get(sort.fieldId);
    if (!sort.nulls || supportsNullPlacement(field, sourceSupportsNulls)) return sort;
    const { nulls: _nulls, ...rest } = sort;
    return rest;
  });
}

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
    () => (supplied || instance.definition.fields).filter((field) => field.sort),
    [instance, instance.definition.fields, supplied],
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
        const title = field ? renderGridNode(field.title) : sort.fieldId;
        const titleText = field ? gridNodeText(field.title) || field.id : sort.fieldId;
        const readOnly = !fields.some((item) => item.id === sort.fieldId);
        const previousReadOnly =
          index > 0 && !fields.some((item) => item.id === value[index - 1]?.fieldId);
        const nextReadOnly =
          index < value.length - 1 && !fields.some((item) => item.id === value[index + 1]?.fieldId);
        return (
          <div className="hui-grid__sort-rule" key={sort.id}>
            <Select
              size="small"
              value={sort.fieldId}
              disabled={readOnly}
              aria-label={`${locale.fields} ${index + 1}`}
              options={[
                ...(!fields.some((item) => item.id === sort.fieldId)
                  ? [{ label: title, value: sort.fieldId, disabled: true }]
                  : []),
                ...fields.map((item) => ({
                  label: renderGridNode(item.title),
                  value: item.id,
                  disabled:
                    item.id !== sort.fieldId &&
                    value.some((current) => current.fieldId === item.id),
                })),
              ]}
              onChange={(fieldId) => {
                const nextField = fields.find((item) => item.id === fieldId);
                onChange(
                  value.map((current, currentIndex) => {
                    if (currentIndex !== index) return current;
                    if (supportsNullPlacement(nextField, instance.capabilities.sort.nulls)) {
                      return { ...current, fieldId };
                    }
                    const { nulls: _nulls, ...rest } = current;
                    return { ...rest, fieldId };
                  }),
                );
              }}
            />
            <Select
              size="small"
              value={sort.direction}
              disabled={readOnly}
              aria-label={`${titleText}: ${locale.sorts}`}
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
            {(sort.nulls || supportsNullPlacement(field, instance.capabilities.sort.nulls)) && (
              <Select
                size="small"
                value={sort.nulls}
                allowClear
                disabled={readOnly}
                placeholder={locale.defaultNullPlacement}
                aria-label={`${titleText}: ${locale.nullsLast}/${locale.nullsFirst}`}
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
                disabled={readOnly || !index || previousReadOnly}
                aria-label={`${locale.moveUp}: ${titleText}`}
                icon={<ArrowUpOutlined />}
                onClick={() => move(index, index - 1)}
              />
              <Button
                size="small"
                type="text"
                disabled={readOnly || index === value.length - 1 || nextReadOnly}
                aria-label={`${locale.moveDown}: ${titleText}`}
                icon={<ArrowDownOutlined />}
                onClick={() => move(index, index + 1)}
              />
              <Button
                size="small"
                type="text"
                danger
                disabled={readOnly}
                aria-label={`${locale.remove}: ${titleText}`}
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
                ...(supportsNullPlacement(available, instance.capabilities.sort.nulls)
                  ? { nulls: 'last' as const }
                  : {}),
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
  const instance = useGridInstance<Row>();
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  const allSortFields = instance.definition.fields.filter((field) => field.sort);
  const conflict = sortCapabilityConflict(value, allSortFields, instance.capabilities.sort);
  return (
    <div className="hui-grid__panel hui-grid__sort-panel">
      <GridSortBuilder value={value} onChange={onChange} fields={fields} />
      {conflict && <Alert type="error" showIcon title={locale.sortCapabilityConflict} />}
      {(onCancel || onClear || onApply) && <Divider />}
      {(onCancel || onClear || onApply) && (
        <div className="hui-grid__panel-footer">
          {onCancel && (
            <Button size="small" onClick={onCancel}>
              {locale.cancel}
            </Button>
          )}
          {onClear && (
            <Button size="small" onClick={onClear}>
              {locale.clear}
            </Button>
          )}
          {onApply && (
            <Button
              size="small"
              type="primary"
              disabled={conflict}
              onClick={() =>
                onApply(normalizeSortNulls(value, allSortFields, instance.capabilities.sort.nulls))
              }
            >
              {locale.apply}
            </Button>
          )}
        </div>
      )}
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
  const draftDirtyRef = useRef(false);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    const opening = open && !wasOpenRef.current;
    if (!open || opening || !draftDirtyRef.current) {
      setDraft(sorts.map((sort) => ({ ...sort })));
    }
    if (!open) draftDirtyRef.current = false;
    wasOpenRef.current = open;
  }, [open, sorts]);

  const button =
    typeof trigger === 'function'
      ? trigger({ open, count: sorts.length })
      : (trigger ?? (
          <Button
            size="small"
            type={sorts.length ? 'default' : 'text'}
            icon={<SortAscendingOutlined />}
          >
            {locale.sorts}
            {sorts.length ? ` ${sorts.length}` : ''}
          </Button>
        ));
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
          onChange={(value) => {
            draftDirtyRef.current = true;
            setDraft(value);
          }}
          onCancel={() => {
            draftDirtyRef.current = false;
            setOpen(false);
          }}
          onClear={() => {
            draftDirtyRef.current = false;
            setDraft([]);
            instance.query.setSorts([], 'user');
            setOpen(false);
          }}
          onApply={(value) => {
            draftDirtyRef.current = false;
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
