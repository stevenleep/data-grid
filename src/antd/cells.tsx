import {
  CheckCircleFilled,
  CloseCircleFilled,
  FileOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import {
  Avatar,
  DatePicker,
  Image,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import { useRef, type ReactNode } from 'react';
import type { GridOption, GridResolvedField, GridRowKey } from '../core';
import { useGridInstance, useGridSelector } from '../react';
import { useGridUi } from './context';
import { useGridOptions } from './hooks';
import { resolveGridLocale } from './locale';

const emptyCell = <span className="hui-grid__empty-value">—</span>;

function safeUrl(value: unknown, image = false): string | undefined {
  const url = String(value ?? '').trim();
  if (!url) return undefined;
  if (/^(?:\/|\.\/|\.\.\/|#|\?)/.test(url)) return url;
  const scheme = url.match(/^([a-z][a-z\d+.-]*):/i)?.[1]?.toLocaleLowerCase();
  if (!scheme) return url;
  if (scheme === 'http' || scheme === 'https' || (image && scheme === 'blob')) return url;
  if (!image && (scheme === 'mailto' || scheme === 'tel')) return url;
  if (image && /^data:image\/(?:png|jpe?g|gif|webp|avif);/i.test(url)) return url;
  return undefined;
}

function optionLabel(value: unknown, options: GridOption[] | undefined): ReactNode | undefined {
  return options?.find((option) => String(option.value) === String(value))?.label as ReactNode;
}

function objectLabel(value: unknown): string {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  const record = value as Record<string, unknown>;
  return String(record.label ?? record.name ?? record.title ?? record.id ?? '');
}

function decimalText(value: unknown, locale: string, maximumFractionDigits = 20): string {
  const raw = String(value).trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(raw)) return raw;
  const [integer = '0', fraction] = raw.replace(/^\+/, '').split('.');
  if (integer.replace('-', '').length <= 15) {
    const number = Number(raw);
    if (Number.isFinite(number)) {
      return new Intl.NumberFormat(locale, { maximumFractionDigits }).format(number);
    }
  }
  const parts = new Intl.NumberFormat(locale).formatToParts(1234.5);
  const group = parts.find((part) => part.type === 'group')?.value || ',';
  const decimal = parts.find((part) => part.type === 'decimal')?.value || '.';
  const sign = integer.startsWith('-') ? '-' : '';
  const digits = integer.replace('-', '');
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return `${sign}${grouped}${fraction ? `${decimal}${fraction.slice(0, maximumFractionDigits)}` : ''}`;
}

function dateText(value: unknown, locale: string, timeZone: string | undefined, withTime: boolean) {
  const dateOnly = !withTime && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = dateOnly
    ? new Date(`${value}T00:00:00.000Z`)
    : value instanceof Date
      ? value
      : new Date(String(value));
  if (Number.isNaN(date.valueOf())) return String(value);
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' as const } : {}),
    ...(dateOnly ? { timeZone: 'UTC' } : timeZone ? { timeZone } : {}),
  }).format(date);
}

function renderFile(value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  return (
    <Space size={4} wrap>
      {values.map((item, index) => {
        const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
        const label = String(record.name ?? record.label ?? item ?? 'File');
        const href = safeUrl(record.url);
        return href ? (
          <Typography.Link key={`${label}-${index}`} href={href} target="_blank" rel="noreferrer">
            <FileOutlined /> {label}
          </Typography.Link>
        ) : (
          <span key={`${label}-${index}`}>
            <FileOutlined /> {label}
          </span>
        );
      })}
    </Space>
  );
}

function renderDuration(value: unknown, field: GridResolvedField<object>) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  const unit = String(field.meta?.durationUnit || 'milliseconds');
  const milliseconds =
    unit === 'seconds' ? number * 1000 : unit === 'minutes' ? number * 60_000 : number;
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  return [
    hours ? `${hours}h` : '',
    minutes ? `${minutes}m` : '',
    seconds || (!hours && !minutes) ? `${seconds}s` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function renderGridValue<Row extends object>(
  value: unknown,
  field: GridResolvedField<Row>,
  locale: string,
  timeZone?: string,
): ReactNode {
  if (field.isEmpty(value)) return emptyCell;
  const options = Array.isArray(field.options) ? field.options : undefined;

  switch (field.valueType) {
    case 'number': {
      const number = Number(value);
      return Number.isFinite(number)
        ? new Intl.NumberFormat(locale, { maximumFractionDigits: 20 }).format(number)
        : String(value);
    }
    case 'decimal':
      return decimalText(value, locale);
    case 'money': {
      const record =
        value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
      const amount = record?.amount ?? value;
      const currency = String(record?.currency ?? field.meta?.currency ?? 'CNY');
      const number = Number(amount);
      return Number.isFinite(number)
        ? new Intl.NumberFormat(locale, {
            style: 'currency',
            currency,
            maximumFractionDigits: Number(field.meta?.maximumFractionDigits ?? 2),
          }).format(number)
        : `${currency} ${decimalText(amount, locale)}`;
    }
    case 'percent': {
      const scale = field.meta?.percentScale === 'ratio' ? 1 : 100;
      const number = Number(value);
      return Number.isFinite(number)
        ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(
            number / scale,
          )
        : String(value);
    }
    case 'duration':
      return renderDuration(value, field as unknown as GridResolvedField<object>);
    case 'boolean':
      return value === true || value === 1 || value === '1' ? (
        <CheckCircleFilled className="hui-grid__boolean--true" aria-label="true" />
      ) : (
        <CloseCircleFilled className="hui-grid__boolean--false" aria-label="false" />
      );
    case 'select':
    case 'status': {
      const option = options?.find((item) => String(item.value) === String(value));
      return <Tag color={option?.color}>{optionLabel(value, options) ?? objectLabel(value)}</Tag>;
    }
    case 'multiSelect': {
      const values = Array.isArray(value) ? value : [value];
      return (
        <Space size={[4, 2]} wrap>
          {values.map((item, index) => (
            <Tag key={`${String(item)}-${index}`}>
              {optionLabel(item, options) ?? objectLabel(item)}
            </Tag>
          ))}
        </Space>
      );
    }
    case 'user':
    case 'relation': {
      const values = Array.isArray(value) ? value : [value];
      return (
        <Space size={6} wrap>
          {values.map((item, index) => {
            const record =
              item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
            const label = optionLabel(item, options) ?? objectLabel(item);
            const avatar = typeof record.avatar === 'string' ? record.avatar : undefined;
            return (
              <span className="hui-grid__entity" key={`${String(label)}-${index}`}>
                {field.valueType === 'user' && (
                  <Avatar size={18} src={avatar}>
                    {objectLabel(item).slice(0, 1)}
                  </Avatar>
                )}
                <span>{label}</span>
              </span>
            );
          })}
        </Space>
      );
    }
    case 'date':
      return dateText(value, locale, timeZone, false);
    case 'dateTime':
      return dateText(value, locale, timeZone, true);
    case 'link': {
      const record =
        value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
      const href = String(record?.url ?? record?.href ?? value);
      const label = String(record?.label ?? record?.name ?? href);
      const safeHref = safeUrl(href);
      if (!safeHref) return label;
      return (
        <Typography.Link href={safeHref} target="_blank" rel="noreferrer">
          <LinkOutlined /> {label}
        </Typography.Link>
      );
    }
    case 'email':
      return <Typography.Link href={`mailto:${String(value)}`}>{String(value)}</Typography.Link>;
    case 'phone':
      return <Typography.Link href={`tel:${String(value)}`}>{String(value)}</Typography.Link>;
    case 'image': {
      const values = Array.isArray(value) ? value : [value];
      return (
        <Space size={4}>
          {values.slice(0, 3).map((item, index) => {
            const source = safeUrl(
              typeof item === 'string'
                ? item
                : String((item as Record<string, unknown>)?.url ?? ''),
              true,
            );
            return source ? (
              <Image key={`${source}-${index}`} width={28} height={28} src={source} />
            ) : null;
          })}
        </Space>
      );
    }
    case 'file':
      return renderFile(value);
    case 'json': {
      let content: string;
      try {
        content = JSON.stringify(value);
      } catch {
        content = String(value);
      }
      return <Typography.Text code>{content}</Typography.Text>;
    }
    case 'longText':
      return (
        <Typography.Text ellipsis={{ tooltip: String(value) }}>{String(value)}</Typography.Text>
      );
    default:
      return String(value);
  }
}

export interface GridCellProps<Row extends object> {
  row: Row;
  rowIndex: number;
  field: GridResolvedField<Row>;
}

export function GridCell<Row extends object>({ row, rowIndex, field }: GridCellProps<Row>) {
  const instance = useGridInstance<Row>();
  const ui = useGridUi<Row>();
  const value = field.getValue(row);
  if (field.render) return field.render({ value, row, rowIndex, field, instance }) as ReactNode;
  return renderGridValue(value, field, ui.language || 'zh-CN', ui.timeZone);
}

export interface GridEditableCellProps<Row extends object> extends GridCellProps<Row> {
  children: ReactNode;
}

export function GridEditableCell<Row extends object>({
  row,
  rowIndex,
  field,
  children,
}: GridEditableCellProps<Row>) {
  const instance = useGridInstance<Row>();
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  const rowKey = instance.definition.getRowKey(row);
  const editing = useGridSelector<Row, ReturnType<typeof instance.getState>['editing']>(
    (state) => state.editing,
  );
  const active = editing.active?.rowKey === rowKey && editing.active.fieldId === field.id;
  const draft = active ? editing.active?.draft : field.getValue(row);
  const editorType = field.edit && field.edit.editor ? field.edit.editor : field.valueType;
  const usesOptions = ['select', 'multiSelect', 'status', 'user', 'relation', 'boolean'].includes(
    editorType,
  );
  const options = useGridOptions(field, '', active && usesOptions);
  const committingRef = useRef(false);
  const canEdit = instance.editing.canEdit(row, field.id);
  const commit = async () => {
    if (committingRef.current) return false;
    committingRef.current = true;
    try {
      return await instance.editing.commit();
    } finally {
      committingRef.current = false;
    }
  };
  if (!canEdit) return children;

  let input: ReactNode;
  if (field.editor && active) {
    input = field.editor({
      value: field.getValue(row),
      row,
      rowIndex,
      field,
      instance,
      draft,
      saving: editing.saving,
      error: editing.error,
      setDraft: instance.editing.setDraft,
      commit,
      cancel: instance.editing.cancel,
    }) as ReactNode;
  } else if (['number', 'decimal', 'money', 'percent', 'duration'].includes(editorType)) {
    input = (
      <InputNumber
        size="small"
        autoFocus
        stringMode={editorType === 'decimal' || editorType === 'money'}
        value={draft as number | string | null | undefined}
        onChange={instance.editing.setDraft}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void commit();
          if (event.key === 'Escape') instance.editing.cancel();
        }}
      />
    );
  } else if (
    ['select', 'multiSelect', 'status', 'user', 'relation', 'boolean'].includes(editorType)
  ) {
    input = (
      <Select
        size="small"
        autoFocus
        open
        loading={options.loading}
        mode={['multiSelect', 'user', 'relation'].includes(editorType) ? 'multiple' : undefined}
        options={
          editorType === 'boolean'
            ? [
                { label: ui.language?.startsWith('en') ? 'Yes' : '是', value: true },
                { label: ui.language?.startsWith('en') ? 'No' : '否', value: false },
              ]
            : (options.options as Array<{ label: ReactNode; value: string | number | boolean }>)
        }
        value={draft as string | number | boolean | (string | number)[] | undefined}
        onChange={(value) => {
          instance.editing.setDraft(value);
          queueMicrotask(() => void commit());
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') instance.editing.cancel();
        }}
      />
    );
  } else if (editorType === 'date' || editorType === 'dateTime') {
    const current = draft ? dayjs(String(draft)) : null;
    input = (
      <DatePicker
        size="small"
        autoFocus
        open
        showTime={editorType === 'dateTime'}
        value={current?.isValid() ? current : null}
        onChange={(date) => {
          const value = date
            ? editorType === 'date'
              ? date.format('YYYY-MM-DD')
              : date.toISOString()
            : undefined;
          instance.editing.setDraft(value);
          queueMicrotask(() => void commit());
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') instance.editing.cancel();
        }}
      />
    );
  } else {
    input = (
      <Input
        size="small"
        autoFocus
        value={draft == null ? '' : String(draft)}
        onChange={(event) => instance.editing.setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void commit();
          if (event.key === 'Escape') instance.editing.cancel();
        }}
      />
    );
  }

  if (active) {
    return (
      <Tooltip open={Boolean(editing.error)} title={editing.error} color="red">
        <Spin spinning={editing.saving} size="small">
          <div className="hui-grid__cell-editor">{input}</div>
        </Spin>
      </Tooltip>
    );
  }

  return (
    <div
      className="hui-grid__editable-cell"
      tabIndex={0}
      role="button"
      aria-label={locale.editCell(String(field.title))}
      onDoubleClick={() => instance.editing.begin(row, field.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') instance.editing.begin(row, field.id);
      }}
    >
      {children}
    </div>
  );
}
