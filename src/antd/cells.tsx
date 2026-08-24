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
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { GridOption, GridResolvedField, GridRowKey } from '../core';
import { useGridInstance, useGridSelector } from '../react';
import { useGridUi } from './context';
import { useGridOptions } from './hooks';
import {
  getDateTimeFormatter,
  getNumberFormatter,
  gridDayjsValue,
  parseGridDate,
  resolveGridTimeZone,
  resolveIntlLocale,
} from './intl';
import { resolveGridLocale } from './locale';
import { gridNodeText, renderGridNode, safeGridText } from './render';
import type { GridLocale } from './types';

const emptyCell = <span className="hui-grid__empty-value">—</span>;

function safeUrl(value: unknown, image = false): string | undefined {
  const url = safeGridText(value).trim();
  if (!url) return undefined;
  if (/^(?:\/|\.\/|\.\.\/|#|\?)/.test(url)) return url;
  const scheme = url.match(/^([a-z][a-z\d+.-]*):/i)?.[1]?.toLocaleLowerCase();
  if (!scheme) return url;
  if (scheme === 'http' || scheme === 'https' || (image && scheme === 'blob')) return url;
  if (!image && (scheme === 'mailto' || scheme === 'tel')) return url;
  if (image && /^data:image\/(?:png|jpe?g|gif|webp|avif);/i.test(url)) return url;
  return undefined;
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

function focusEditableRowSibling(element: HTMLElement, direction: -1 | 1): void {
  const cell = element.closest('td');
  const row = cell?.parentElement;
  if (!cell || !row) return;
  const cellIndex = Array.from(row.children).indexOf(cell);
  let sibling = direction < 0 ? row.previousElementSibling : row.nextElementSibling;
  while (sibling) {
    const target = sibling.children[cellIndex]?.querySelector<HTMLElement>(
      '[data-grid-editable="true"]',
    );
    if (target) {
      target.focus();
      return;
    }
    sibling = direction < 0 ? sibling.previousElementSibling : sibling.nextElementSibling;
  }
}

function optionLabel(value: unknown, options: GridOption[] | undefined): ReactNode | undefined {
  const key = entityOptionValue(value);
  const label = options?.find((option) => Object.is(option.value, key))?.label;
  return label === undefined ? undefined : renderGridNode(label);
}

function entityOptionValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  try {
    const record = value as Record<string, unknown>;
    return record.value ?? record.id ?? record.key ?? value;
  } catch {
    return value;
  }
}

function objectLabel(value: unknown): string {
  try {
    if (value == null) return '';
    if (typeof value !== 'object') return safeGridText(value);
    const record = value as Record<string, unknown>;
    return safeGridText(record.label ?? record.name ?? record.title ?? record.id ?? value);
  } catch {
    return safeGridText(value);
  }
}

function decimalText(
  value: unknown,
  locale: string,
  maximumFractionDigits: number | null = 20,
): string {
  const raw = safeGridText(value).trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(raw)) return raw;
  const [integer = '0', fraction] = raw.replace(/^\+/, '').split('.');
  if (maximumFractionDigits !== null && canSafelyFormatDecimal(raw)) {
    const number = Number(raw);
    if (Number.isFinite(number)) {
      return getNumberFormatter(locale, { maximumFractionDigits }).format(number);
    }
  }
  const parts = getNumberFormatter(locale).formatToParts(1234.5);
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
  const raw = safeGridText(value).trim().replace(/^\+/, '');
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return false;
  const number = Number(raw);
  if (!Number.isFinite(number)) return false;
  if (!raw.includes('.')) return Number.isSafeInteger(number);
  const significant = raw.replace('-', '').replace('.', '').replace(/^0+/, '').replace(/0+$/, '');
  return significant.length <= 15;
}

function dateText(value: unknown, locale: string, timeZone: string | undefined, withTime: boolean) {
  const date = parseGridDate(value, withTime);
  if (!date) return safeGridText(value);
  return getDateTimeFormatter(locale, {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' as const } : {}),
    timeZone: withTime ? resolveGridTimeZone(timeZone) : 'UTC',
  }).format(date);
}

function renderFile(value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  return (
    <Space size={4} wrap>
      {values.map((item, index) => {
        const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
        const label = safeGridText(record.name ?? record.label ?? item ?? 'File', 'File');
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
  let number: number;
  try {
    number = Number(value);
  } catch {
    return safeGridText(value);
  }
  if (!Number.isFinite(number)) return safeGridText(value);
  const unit = safeGridText(field.meta?.durationUnit || 'milliseconds');
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
  labels?: Pick<GridLocale, 'trueLabel' | 'falseLabel'>,
): ReactNode {
  if (field.isEmpty(value)) return emptyCell;
  const options = Array.isArray(field.options) ? field.options : undefined;
  const resolvedLocale = resolveIntlLocale(locale);

  try {
    switch (field.valueType) {
      case 'number': {
        const number = Number(value);
        return Number.isFinite(number)
          ? getNumberFormatter(resolvedLocale, { maximumFractionDigits: 20 }).format(number)
          : safeGridText(value);
      }
      case 'decimal':
        return decimalText(value, resolvedLocale);
      case 'money': {
        const record =
          value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
        const amount = record?.amount ?? value;
        const currency = safeGridText(record?.currency ?? field.meta?.currency ?? 'CNY', 'CNY');
        const configuredDigits = Number(field.meta?.maximumFractionDigits ?? 2);
        const maximumFractionDigits = Number.isFinite(configuredDigits)
          ? Math.min(20, Math.max(0, Math.trunc(configuredDigits)))
          : 2;
        const number = Number(amount);
        if (Number.isFinite(number) && canSafelyFormatDecimal(amount)) {
          try {
            return getNumberFormatter(resolvedLocale, {
              style: 'currency',
              currency,
              maximumFractionDigits,
            }).format(number);
          } catch {
            // Invalid currency identifiers fall back to a safe, exact text representation.
          }
        }
        return `${currency} ${decimalText(amount, resolvedLocale, null)}`;
      }
      case 'percent': {
        const scale = field.meta?.percentScale === 'ratio' ? 1 : 100;
        const number = Number(value);
        return Number.isFinite(number)
          ? getNumberFormatter(resolvedLocale, {
              style: 'percent',
              maximumFractionDigits: 2,
            }).format(number / scale)
          : safeGridText(value);
      }
      case 'duration':
        return renderDuration(value, field as unknown as GridResolvedField<object>);
      case 'boolean':
        return value === true || value === 1 || value === '1' ? (
          <CheckCircleFilled
            className="hui-grid__boolean--true"
            aria-label={labels?.trueLabel || 'true'}
          />
        ) : (
          <CloseCircleFilled
            className="hui-grid__boolean--false"
            aria-label={labels?.falseLabel || 'false'}
          />
        );
      case 'select':
      case 'status': {
        const optionValue = entityOptionValue(value);
        const option = options?.find((item) => Object.is(item.value, optionValue));
        return <Tag color={option?.color}>{optionLabel(value, options) ?? objectLabel(value)}</Tag>;
      }
      case 'multiSelect': {
        const values = Array.isArray(value) ? value : [value];
        return (
          <Space size={[4, 2]} wrap>
            {values.map((item, index) => {
              const optionValue = entityOptionValue(item);
              const option = options?.find((candidate) => Object.is(candidate.value, optionValue));
              return (
                <Tag color={option?.color} key={`${safeGridText(item)}-${index}`}>
                  {optionLabel(item, options) ?? objectLabel(item)}
                </Tag>
              );
            })}
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
              const labelText =
                gridNodeText(label) || objectLabel(item) || gridNodeText(field.title);
              return (
                <span className="hui-grid__entity" key={`${gridNodeText(label)}-${index}`}>
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
        return dateText(value, resolvedLocale, timeZone, false);
      case 'dateTime':
        return dateText(value, resolvedLocale, timeZone, true);
      case 'link': {
        const record =
          value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
        const href = safeGridText(record?.url ?? record?.href ?? value);
        const label = safeGridText(record?.label ?? record?.name ?? href);
        const safeHref = safeUrl(href);
        if (!safeHref) return label;
        return (
          <Typography.Link href={safeHref} target="_blank" rel="noreferrer">
            <LinkOutlined /> {label}
          </Typography.Link>
        );
      }
      case 'email': {
        const text = safeGridText(value);
        return <Typography.Link href={`mailto:${text}`}>{text}</Typography.Link>;
      }
      case 'phone': {
        const text = safeGridText(value);
        return <Typography.Link href={`tel:${text}`}>{text}</Typography.Link>;
      }
      case 'image': {
        const values = Array.isArray(value) ? value : [value];
        return (
          <Space size={4}>
            {values.slice(0, 3).map((item, index) => {
              const record =
                item && typeof item === 'object' ? (item as Record<string, unknown>) : undefined;
              const source = safeUrl(
                typeof item === 'string' ? item : safeGridText(record?.url),
                true,
              );
              const alt = safeGridText(
                record?.alt ?? record?.name ?? record?.label ?? gridNodeText(field.title),
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
          content = JSON.stringify(value) ?? safeGridText(value);
        } catch {
          content = safeGridText(value);
        }
        return <Typography.Text code>{content}</Typography.Text>;
      }
      case 'longText': {
        const text = safeGridText(value);
        return <Typography.Text ellipsis={{ tooltip: text }}>{text}</Typography.Text>;
      }
      default:
        return safeGridText(value);
    }
  } catch {
    return safeGridText(value, '—');
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
  const locale = resolveGridLocale(ui.locale, ui.language);
  return renderGridValue(value, field, ui.language || 'zh-CN', ui.timeZone, locale);
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

function jsonEditorText(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2) ?? safeGridText(value);
  } catch {
    return safeGridText(value);
  }
}

function isOptionPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
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
      state.editing.active !== undefined &&
      String(state.editing.active.rowKey) === String(rowKey) &&
      state.editing.active.fieldId === field.id;
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
  const [optionSearch, setOptionSearch] = useState('');
  const [jsonText, setJsonText] = useState('');
  const [localError, setLocalError] = useState<string>();
  const activeEditorKey = active ? `${String(rowKey)}:${field.id}` : '';
  useEffect(() => {
    setOptionSearch('');
    setLocalError(undefined);
    if (active && editorType === 'json') setJsonText(jsonEditorText(draft));
    // Draft is intentionally captured only when a new cell editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEditorKey, editorType]);
  const options = useGridOptions(field, optionSearch, active && usesOptions && !field.editor);
  const committingRef = useRef(false);
  const numericModeRef = useRef<{ key: string; stringMode: boolean } | undefined>(undefined);
  const canEdit = instance.editing.canEdit(row, field.id);
  useEffect(() => {
    if (active && !canEdit) instance.editing.cancel();
  }, [active, canEdit, instance]);
  const coreEditingError =
    editing.errorCode === 'required'
      ? locale.required
      : editing.errorCode === 'saveFailed'
        ? locale.saveFailed
        : editing.error;
  const editingError = localError || coreEditingError || options.error?.message;
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
    const moneyRecord =
      editorType === 'money' && draft && typeof draft === 'object' && !Array.isArray(draft)
        ? (draft as Record<string, unknown>)
        : undefined;
    const numericDraft = moneyRecord ? moneyRecord.amount : draft;
    if (numericModeRef.current?.key !== activeEditorKey) {
      const configuredNumericMode = field.edit ? field.edit.numericMode : undefined;
      numericModeRef.current = {
        key: activeEditorKey,
        stringMode:
          configuredNumericMode !== undefined
            ? configuredNumericMode === 'string'
            : editorType === 'decimal' ||
              (editorType === 'money' &&
                (typeof numericDraft === 'string' || numericDraft == null)),
      };
    }
    const stringMode = numericModeRef.current.stringMode;
    const ratioPercent = editorType === 'percent' && field.meta?.percentScale === 'ratio';
    const numericInputDraft = (() => {
      if (!ratioPercent || numericDraft == null || numericDraft === '') return numericDraft;
      const value = Number(numericDraft);
      return Number.isFinite(value) ? value * 100 : numericDraft;
    })();
    input = (
      <InputNumber
        size="small"
        autoFocus
        stringMode={stringMode}
        placeholder={field.edit ? field.edit.placeholder : undefined}
        value={numericInputDraft as number | string | null | undefined}
        onChange={(value) => {
          const nextValue =
            ratioPercent && value != null && Number.isFinite(Number(value))
              ? Number(value) / 100
              : value;
          instance.editing.setDraft(
            moneyRecord ? { ...moneyRecord, amount: nextValue } : nextValue,
          );
        }}
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
    const editMultiple = field.edit ? field.edit.multiple : undefined;
    const metaMultiple =
      typeof field.meta?.multiple === 'boolean' ? field.meta.multiple : undefined;
    const multiple =
      editorType === 'multiSelect' ||
      (['user', 'relation'].includes(editorType) &&
        (editMultiple ?? metaMultiple ?? Array.isArray(draft)));
    const draftItems = multiple
      ? Array.isArray(draft)
        ? draft
        : draft == null
          ? []
          : [draft]
      : [];
    const selectedValue = multiple
      ? draftItems.map(entityOptionValue).filter(isOptionPrimitive)
      : entityOptionValue(draft);
    const preserveDomainValue = (value: unknown) => {
      const candidates = multiple ? draftItems : draft == null ? [] : [draft];
      return (
        candidates.find((candidate) => Object.is(entityOptionValue(candidate), value)) ?? value
      );
    };
    const setSelectedDraft = (value: unknown) => {
      const semanticValue =
        multiple && Array.isArray(value)
          ? value.map(preserveDomainValue)
          : preserveDomainValue(value);
      instance.editing.setDraft(semanticValue);
      setLocalError(undefined);
    };
    input = (
      <Select
        size="small"
        autoFocus
        defaultOpen
        allowClear
        showSearch={editorType !== 'boolean'}
        filterOption={Array.isArray(field.options) ? undefined : false}
        placeholder={field.edit ? field.edit.placeholder : undefined}
        loading={options.loading}
        notFoundContent={
          options.loading ? (
            <span role="status">{locale.loadingOptions}</span>
          ) : options.error ? (
            <span role="alert">{options.error.message}</span>
          ) : undefined
        }
        mode={multiple ? 'multiple' : undefined}
        options={
          editorType === 'boolean'
            ? [
                { label: locale.yes, value: true },
                { label: locale.no, value: false },
              ]
            : (options.options.map((option) => ({
                ...option,
                label: renderGridNode(option.label),
              })) as Array<{ label: ReactNode; value: string | number | boolean }>)
        }
        value={
          selectedValue as string | number | boolean | (string | number | boolean)[] | undefined
        }
        onSearch={editorType === 'boolean' ? undefined : setOptionSearch}
        onChange={(value) => {
          setSelectedDraft(value);
          if (!multiple) queueMicrotask(() => void commit());
        }}
        onBlur={() => {
          if (multiple) void commit();
        }}
        onOpenChange={(open) => {
          if (!open && multiple) void commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') instance.editing.cancel();
        }}
      />
    );
  } else if (editorType === 'date' || editorType === 'dateTime') {
    const current = gridDayjsValue(draft, editorType === 'dateTime', ui.timeZone);
    input = (
      <DatePicker
        size="small"
        autoFocus
        defaultOpen
        placeholder={field.edit ? field.edit.placeholder : undefined}
        showTime={editorType === 'dateTime'}
        value={current}
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
  } else if (editorType === 'longText' || editorType === 'json') {
    const inputValue = editorType === 'json' ? jsonText : draft == null ? '' : safeGridText(draft);
    const setTextDraft = (value: string) => {
      if (editorType !== 'json') {
        instance.editing.setDraft(value);
        return;
      }
      setJsonText(value);
      if (!value.trim()) {
        setLocalError(undefined);
        instance.editing.setDraft(undefined);
        return;
      }
      try {
        instance.editing.setDraft(JSON.parse(value));
        setLocalError(undefined);
      } catch {
        setLocalError(locale.invalidJson);
      }
    };
    input = (
      <Input.TextArea
        size="small"
        autoFocus
        autoSize={{ minRows: editorType === 'json' ? 3 : 2, maxRows: 8 }}
        placeholder={field.edit ? field.edit.placeholder : undefined}
        value={inputValue}
        aria-invalid={Boolean(localError)}
        onChange={(event) => setTextDraft(event.target.value)}
        onBlur={() => {
          if (!localError) void commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !localError) {
            event.preventDefault();
            void commit();
          }
          if (event.key === 'Escape') instance.editing.cancel();
        }}
      />
    );
  } else {
    input = (
      <Input
        size="small"
        autoFocus
        placeholder={field.edit ? field.edit.placeholder : undefined}
        value={draft == null ? '' : safeGridText(draft)}
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
      data-grid-editable="true"
      tabIndex={rowIndex === 0 ? 0 : -1}
      role="button"
      aria-label={locale.editCell(gridNodeText(field.title) || field.id)}
      aria-keyshortcuts="Enter Space"
      onClick={(event) => {
        if (
          event.detail === 0 &&
          event.target === event.currentTarget &&
          !isInteractiveDescendant(event.target, event.currentTarget)
        ) {
          instance.editing.begin(row, field.id);
        }
      }}
      onDoubleClick={(event) => {
        if (!isInteractiveDescendant(event.target, event.currentTarget)) {
          instance.editing.begin(row, field.id);
        }
      }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          event.currentTarget.click();
        }
        if (event.target === event.currentTarget && event.key === 'ArrowUp') {
          event.preventDefault();
          focusEditableRowSibling(event.currentTarget, -1);
        }
        if (event.target === event.currentTarget && event.key === 'ArrowDown') {
          event.preventDefault();
          focusEditableRowSibling(event.currentTarget, 1);
        }
      }}
    >
      {children}
    </div>
  );
}
