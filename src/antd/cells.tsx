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
import { gridNodeText, renderGridNode } from './render';

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
  const label = options?.find((option) => String(option.value) === String(value))?.label;
  return label === undefined ? undefined : renderGridNode(label);
}

function objectLabel(value: unknown): string {
  if (value == null) return '';
  if (typeof value !== 'object') return String(value);
  const record = value as Record<string, unknown>;
  return String(record.label ?? record.name ?? record.title ?? record.id ?? '');
}

function decimalText(
  value: unknown,
  locale: string,
  maximumFractionDigits: number | null = 20,
): string {
  const raw = String(value).trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(raw)) return raw;
  const [integer = '0', fraction] = raw.replace(/^\+/, '').split('.');
  if (maximumFractionDigits !== null && canSafelyFormatDecimal(raw)) {
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
  const visibleFraction =
    fraction && maximumFractionDigits !== null
      ? fraction.slice(0, maximumFractionDigits)
      : fraction;
  return `${sign}${grouped}${visibleFraction ? `${decimal}${visibleFraction}` : ''}`;
}

function canSafelyFormatDecimal(value: unknown): boolean {
  const raw = String(value).trim().replace(/^\+/, '');
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return false;
  const number = Number(raw);
  if (!Number.isFinite(number)) return false;
  if (!raw.includes('.')) return Number.isSafeInteger(number);
  const significant = raw.replace('-', '').replace('.', '').replace(/^0+/, '').replace(/0+$/, '');
  return significant.length <= 15;
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
      const configuredDigits = Number(field.meta?.maximumFractionDigits ?? 2);
      const maximumFractionDigits = Number.isFinite(configuredDigits)
        ? Math.min(20, Math.max(0, Math.trunc(configuredDigits)))
        : 2;
      const number = Number(amount);
      if (Number.isFinite(number) && canSafelyFormatDecimal(amount)) {
        try {
          return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency,
            maximumFractionDigits,
          }).format(number);
        } catch {
          // Invalid currency identifiers fall back to a safe, exact text representation.
        }
      }
      return `${currency} ${decimalText(amount, locale, null)}`;
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
            const avatar =
              typeof record.avatar === 'string' ? safeUrl(record.avatar, true) : undefined;
            const labelText = gridNodeText(label) || objectLabel(item) || gridNodeText(field.title);
            return (
              <span className="hui-grid__entity" key={`${String(label)}-${index}`}>
                {field.valueType === 'user' && (
                  <Avatar size={18} src={avatar} alt={labelText}>
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
            const record =
              item && typeof item === 'object' ? (item as Record<string, unknown>) : undefined;
            const source = safeUrl(
              typeof item === 'string' ? item : String(record?.url ?? ''),
              true,
            );
            const alt = String(
              (record?.alt ?? record?.name ?? record?.label ?? gridNodeText(field.title)) ||
                `Image ${index + 1}`,
            );
            return source ? (
              <Image key={`${source}-${index}`} width={28} height={28} src={source} alt={alt} />
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
  if (field.render) return renderGridNode(field.render({ value, row, rowIndex, field, instance }));
  return renderGridValue(value, field, ui.language || 'zh-CN', ui.timeZone);
}

interface EditingCellSnapshot {
  active: boolean;
  draft?: unknown;
  saving: boolean;
  error?: string;
  errorCode?: 'required' | 'validation' | 'saveFailed';
}

const inactiveEditingCell: EditingCellSnapshot = {
  active: false,
  saving: false,
};

function editingCellEqual(left: EditingCellSnapshot, right: EditingCellSnapshot): boolean {
  return (
    left.active === right.active &&
    left.draft === right.draft &&
    left.saving === right.saving &&
    left.error === right.error &&
    left.errorCode === right.errorCode
  );
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
  const editing = useGridSelector<Row, EditingCellSnapshot>((state) => {
    const active =
      state.editing.active?.rowKey === rowKey && state.editing.active.fieldId === field.id;
    return active
      ? {
          active: true,
          draft: state.editing.active?.draft,
          saving: state.editing.saving,
          error: state.editing.error,
          errorCode: state.editing.errorCode,
        }
      : inactiveEditingCell;
  }, editingCellEqual);
  const active = editing.active;
  const draft = active ? editing.draft : field.getValue(row);
  const editorType = field.edit && field.edit.editor ? field.edit.editor : field.valueType;
  const usesOptions = ['select', 'multiSelect', 'status', 'user', 'relation'].includes(editorType);
  const options = useGridOptions(field, '', active && usesOptions);
  const committingRef = useRef(false);
  const canEdit = instance.editing.canEdit(row, field.id);
  const editingError =
    editing.errorCode === 'required'
      ? locale.required
      : editing.errorCode === 'saveFailed'
        ? locale.saveFailed
        : editing.error;
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
    input = renderGridNode(
      field.editor({
        value: field.getValue(row),
        row,
        rowIndex,
        field,
        instance,
        draft,
        saving: editing.saving,
        error: editingError,
        setDraft: instance.editing.setDraft,
        commit,
        cancel: instance.editing.cancel,
      }),
    );
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
        notFoundContent={
          options.loading ? <span role="status">{locale.loadingOptions}</span> : undefined
        }
        mode={['multiSelect', 'user', 'relation'].includes(editorType) ? 'multiple' : undefined}
        options={
          editorType === 'boolean'
            ? [
                { label: ui.language?.startsWith('en') ? 'Yes' : '是', value: true },
                { label: ui.language?.startsWith('en') ? 'No' : '否', value: false },
              ]
            : (options.options.map((option) => ({
                ...option,
                label: renderGridNode(option.label),
              })) as Array<{ label: ReactNode; value: string | number | boolean }>)
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
      <Tooltip open={Boolean(editingError)} title={editingError} color="red">
        <Spin spinning={editing.saving} size="small">
          <div className="hui-grid__cell-editor" aria-busy={editing.saving}>
            {input}
          </div>
        </Spin>
      </Tooltip>
    );
  }

  return (
    <div
      className="hui-grid__editable-cell"
      tabIndex={0}
      role="button"
      aria-label={locale.editCell(gridNodeText(field.title) || field.id)}
      onDoubleClick={() => instance.editing.begin(row, field.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          instance.editing.begin(row, field.id);
        }
      }}
    >
      {children}
    </div>
  );
}
