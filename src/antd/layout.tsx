import { ColumnHeightOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Dropdown, Input, Pagination, Select, Space, Tag, Tooltip } from 'antd';
import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import {
  countFilterConditions,
  createFilterGroup,
  removeFilterNode,
  type GridDensity,
  type GridFilterCondition,
  type GridFilterGroup,
  type GridResolvedField,
  type GridSummaryValue,
  type GridTotal as GridTotalValue,
} from '../core';
import { useGridInstance, useGridSelector } from '../react';
import { useGridUi } from './context';
import { renderGridValue } from './cells';
import { resolveGridLocale } from './locale';
import { gridNodeText, renderGridNode, safeGridText } from './render';
import { useGridSelectionCount, useResolvedGridSelectionMode } from './selection-mode';

function classes(...values: Array<string | undefined | false>) {
  return values.filter(Boolean).join(' ');
}

export interface GridShellProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode;
}

export function GridShell({ children, className, ...props }: GridShellProps) {
  return (
    <section {...props} className={classes('hui-grid', className)}>
      {children}
    </section>
  );
}

export interface GridToolbarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  start?: ReactNode;
  end?: ReactNode;
  children?: ReactNode;
}

export function GridToolbar({ start, end, children, className, ...props }: GridToolbarProps) {
  return (
    <div {...props} className={classes('hui-grid__toolbar', className)}>
      <div className="hui-grid__toolbar-start">{start ?? children}</div>
      <div className="hui-grid__toolbar-end">{end}</div>
    </div>
  );
}

export interface GridFooterProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  start?: ReactNode;
  end?: ReactNode;
  children?: ReactNode;
}

export function GridFooter({ start, end, children, className, ...props }: GridFooterProps) {
  return (
    <div {...props} className={classes('hui-grid__footer', className)}>
      <div className="hui-grid__footer-start">{start ?? children}</div>
      <div className="hui-grid__footer-end">{end}</div>
    </div>
  );
}

export function GridToolbarSpacer(props: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} className={classes('hui-grid__spacer', props.className)} aria-hidden />;
}

export interface GridSearchProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  debounce?: number;
  width?: number | string;
  className?: string;
  disabled?: boolean;
}

export function GridSearch<Row extends object>({
  value: controlled,
  onChange,
  placeholder,
  debounce = 300,
  width,
  className,
  disabled,
}: GridSearchProps) {
  const instance = useGridInstance<Row>();
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  const keyword = useGridSelector<Row, string>((state) => state.query.keyword);
  const isControlled = controlled !== undefined;
  const external = controlled !== undefined ? controlled : keyword;
  const [value, setValue] = useState(external);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const committedRef = useRef(external.trim());
  const draftDirtyRef = useRef(false);

  useEffect(() => {
    if (draftDirtyRef.current) return;
    committedRef.current = external.trim();
    setValue(external);
  }, [external]);
  useEffect(() => {
    if (value === external || value.trim() === committedRef.current) {
      draftDirtyRef.current = false;
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
      return;
    }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(
      () => {
        timerRef.current = undefined;
        const next = value.trim();
        draftDirtyRef.current = false;
        committedRef.current = next;
        if (!isControlled && next !== keyword) instance.query.setKeyword(next, 'user');
        onChange?.(next);
        if (isControlled) {
          committedRef.current = external.trim();
          setValue(external);
        }
      },
      Math.max(0, debounce),
    );
    return () => {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    };
  }, [debounce, external, instance, isControlled, keyword, onChange, value]);

  return (
    <Input
      className={classes('hui-grid__search', className)}
      size="small"
      allowClear
      prefix={<SearchOutlined />}
      value={value}
      style={width ? { width } : undefined}
      placeholder={placeholder ?? locale.searchPlaceholder}
      disabled={disabled ?? (isControlled ? !onChange : !instance.capabilities.search)}
      onChange={(event) => {
        draftDirtyRef.current = event.target.value !== external;
        setValue(event.target.value);
      }}
      onPressEnter={() => {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
        const next = value.trim();
        draftDirtyRef.current = false;
        committedRef.current = next;
        if (!isControlled && next !== keyword) instance.query.setKeyword(next, 'user');
        onChange?.(next);
        if (isControlled) {
          committedRef.current = external.trim();
          setValue(external);
        }
      }}
    />
  );
}

export function GridRefresh<Row extends object>({ children }: { children?: ReactNode }) {
  const instance = useGridInstance<Row>();
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  const fetching = useGridSelector<Row, boolean>((state) => state.data.fetching);
  return (
    <Tooltip title={locale.refresh}>
      <Button
        size="small"
        type="text"
        aria-label={locale.refresh}
        icon={<ReloadOutlined spin={fetching} />}
        onClick={() => void instance.data.reload()}
      >
        {children}
      </Button>
    </Tooltip>
  );
}

export function GridDensityMenu<Row extends object>({ children }: { children?: ReactNode }) {
  const instance = useGridInstance<Row>();
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  const density = useGridSelector<Row, GridDensity>((state) => state.columns.density);
  return (
    <Dropdown
      menu={{
        selectedKeys: [density],
        items: [
          { key: 'compact', label: locale.compact },
          { key: 'default', label: locale.standard },
          { key: 'comfortable', label: locale.comfortable },
        ],
        onClick: ({ key }) => instance.columns.setDensity(key as GridDensity),
      }}
    >
      <Tooltip title={locale.density}>
        <Button
          size="small"
          type="text"
          aria-label={locale.density}
          icon={<ColumnHeightOutlined />}
        >
          {children}
        </Button>
      </Tooltip>
    </Dropdown>
  );
}

export function GridStatus<Row extends object>() {
  const instance = useGridInstance<Row>();
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  const data = useGridSelector<Row, ReturnType<typeof instance.getState>['data']>(
    (state) => state.data,
  );
  return (
    <>
      {data.error && (
        <div className="hui-grid__error" role="alert">
          {ui.renderError ? (
            ui.renderError(data.error, instance)
          ) : (
            <>
              <span>{data.error.message}</span>
              <Button size="small" type="link" onClick={() => void instance.data.reload()}>
                {locale.retry}
              </Button>
            </>
          )}
        </div>
      )}
      {Boolean(data.warnings?.length) && (
        <div className="hui-grid__warnings" role="status">
          {data.warnings?.map((warning, index) => (
            <span key={index}>{renderGridNode(warning)}</span>
          ))}
        </div>
      )}
    </>
  );
}

export function GridTotal<Row extends object>() {
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  const total = useGridSelector<Row, GridTotalValue | undefined>((state) => state.data.total);
  if (!total) return null;
  return <span className="hui-grid__total">{locale.total(total.value, total.accuracy)}</span>;
}

export interface GridSummaryProps {
  renderItem?: (item: GridSummaryValue) => ReactNode;
}

export function GridSummary<Row extends object>({ renderItem }: GridSummaryProps = {}) {
  const instance = useGridInstance<Row>();
  const ui = useGridUi<Row>();
  const summary = useGridSelector<Row, GridSummaryValue[] | undefined>(
    (state) => state.data.summary,
  );
  if (!summary?.length) return null;
  return (
    <div className="hui-grid__summary">
      {summary.map((item) => (
        <span className="hui-grid__summary-item" key={item.id}>
          {renderItem ? (
            renderItem(item)
          ) : (
            <>
              <span>{renderGridNode(item.label)}</span>
              <strong>
                {renderGridNode(
                  item.render
                    ? item.render(item.value, item)
                    : item.fieldId && instance.definition.fieldMap.has(item.fieldId)
                      ? renderGridValue(
                          item.value,
                          instance.definition.fieldMap.get(item.fieldId)!,
                          ui.language || 'zh-CN',
                          ui.timeZone,
                          resolveGridLocale(ui.locale, ui.language),
                        )
                      : item.value,
                )}
              </strong>
            </>
          )}
        </span>
      ))}
    </div>
  );
}

export interface GridSelectionSummaryProps {
  allowSelectAll?: boolean;
}

export function GridSelectionSummary<Row extends object>({
  allowSelectAll = true,
}: GridSelectionSummaryProps = {}) {
  const instance = useGridInstance<Row>();
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  const selection = useGridSelector<Row, ReturnType<typeof instance.getState>['selection']>(
    (state) => state.selection,
  );
  const total = useGridSelector<Row, ReturnType<typeof instance.getState>['data']['total']>(
    (state) => state.data.total,
  );
  const configuredSelection = ui.selection ?? instance.definition.defaults?.selection;
  const selectionProps = typeof configuredSelection === 'object' ? configuredSelection : undefined;
  const selectionMode = useResolvedGridSelectionMode(
    instance,
    configuredSelection ? (selectionProps?.type === 'radio' ? 'radio' : 'checkbox') : undefined,
  );
  const count = useGridSelectionCount(instance, selectionMode);
  if (!count) return null;
  const canSelectAll =
    allowSelectAll &&
    selectionMode !== 'radio' &&
    selectionProps?.hideSelectAll !== true &&
    instance.capabilities.selectAllMatching &&
    selection.mode === 'explicit' &&
    total &&
    (!total.accuracy || total.accuracy === 'exact') &&
    count < total.value;
  return (
    <Space size={4}>
      <span className="hui-grid__selection-count">{locale.selected(count)}</span>
      {canSelectAll && (
        <Button size="small" type="link" onClick={instance.selection.selectAllMatching}>
          {locale.selectAll(total.value)}
        </Button>
      )}
      <Button size="small" type="text" onClick={instance.selection.clear}>
        {locale.cancel}
      </Button>
    </Space>
  );
}

export interface GridPaginationProps {
  pageSizeOptions?: number[];
  showSizeChanger?: boolean;
  showQuickJumper?: boolean;
}

export function GridPagination<Row extends object>({
  pageSizeOptions,
  showSizeChanger = true,
  showQuickJumper = true,
}: GridPaginationProps = {}) {
  const instance = useGridInstance<Row>();
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  const query = useGridSelector<Row, ReturnType<typeof instance.getState>['query']>(
    (state) => state.query,
  );
  const data = useGridSelector<Row, ReturnType<typeof instance.getState>['data']>(
    (state) => state.data,
  );
  const sizes = pageSizeOptions || ui.pageSizeOptions || [10, 20, 50, 100];
  const sizeSelect = showSizeChanger ? (
    <Select
      size="small"
      value={query.pagination.pageSize}
      options={sizes.map((size) => ({ label: locale.pageSize(size), value: size }))}
      onChange={(size) => instance.query.setPageSize(size, 'user')}
    />
  ) : null;

  if (query.pagination.type === 'cursor') {
    const canGoPrevious = Boolean(
      !data.fetching && data.pageInfo?.hasPrevious && data.pageInfo.previousCursor,
    );
    const canGoNext = Boolean(!data.fetching && data.pageInfo?.hasNext && data.pageInfo.nextCursor);
    return (
      <Space size={8}>
        {sizeSelect}
        <Button
          size="small"
          disabled={!canGoPrevious}
          onClick={() =>
            instance.query.goToCursor(data.pageInfo?.previousCursor, 'backward', 'user')
          }
        >
          {locale.previousPage}
        </Button>
        <Button
          size="small"
          disabled={!canGoNext}
          onClick={() => instance.query.goToCursor(data.pageInfo?.nextCursor, 'forward', 'user')}
        >
          {locale.nextPage}
        </Button>
      </Space>
    );
  }

  const pagination = query.pagination;

  const exact = data.total && (!data.total.accuracy || data.total.accuracy === 'exact');
  if (exact) {
    return (
      <Pagination
        size="small"
        current={pagination.page}
        pageSize={pagination.pageSize}
        total={data.total!.value}
        pageSizeOptions={sizes}
        showSizeChanger={showSizeChanger}
        showQuickJumper={showQuickJumper}
        onChange={(page, size) => {
          if (size !== pagination.pageSize) instance.query.setPageSize(size, 'user');
          else instance.query.setPage(page, 'user');
        }}
      />
    );
  }

  const canGoPrevious =
    !data.fetching && pagination.page > 1 && data.pageInfo?.hasPrevious !== false;
  const canGoNext =
    !data.fetching &&
    (data.pageInfo?.hasNext !== undefined
      ? data.pageInfo.hasNext
      : data.rows.length >= pagination.pageSize);

  return (
    <Space size={8}>
      {sizeSelect}
      <Button
        size="small"
        disabled={!canGoPrevious}
        onClick={() => instance.query.setPage(pagination.page - 1, 'user')}
      >
        {locale.previousPage}
      </Button>
      <span>{locale.page(pagination.page)}</span>
      <Button
        size="small"
        disabled={!canGoNext}
        onClick={() => instance.query.setPage(pagination.page + 1, 'user')}
      >
        {locale.nextPage}
      </Button>
    </Space>
  );
}

interface ActiveFilterCondition {
  condition: GridFilterCondition;
  groups: Array<{ logic: 'and' | 'or'; negated: boolean }>;
}

function flattenConditions(
  group: GridFilterGroup,
  groups: ActiveFilterCondition['groups'] = [],
  depth = 0,
): ActiveFilterCondition[] {
  const describe = depth > 0 || group.logic === 'or' || group.negated;
  const currentGroups = describe
    ? [...groups, { logic: group.logic, negated: Boolean(group.negated) }]
    : groups;
  return group.children.flatMap((node) =>
    node.type === 'group'
      ? flattenConditions(node, currentGroups, depth + 1)
      : [{ condition: node, groups: currentGroups }],
  );
}

function activeOptionIdentity(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return record.value ?? record.id ?? record.key ?? value;
}

function removeEditableFilterConditions(
  group: GridFilterGroup,
  editableFieldIds: ReadonlySet<string>,
): GridFilterGroup {
  const children: GridFilterGroup['children'] = [];
  group.children.forEach((node) => {
    if (node.type === 'condition') {
      if (!editableFieldIds.has(node.fieldId)) children.push(node);
      return;
    }
    const next = removeEditableFilterConditions(node, editableFieldIds);
    if (countFilterConditions(next)) children.push(next);
  });
  return {
    ...group,
    children,
  };
}

export interface GridActiveFiltersProps<Row extends object = object> {
  maxVisible?: number;
  /** Fields this composed filter surface is allowed to mutate. Other conditions remain readonly. */
  fields?: readonly GridResolvedField<Row>[];
}

export function GridActiveFilters<Row extends object>({
  maxVisible = 8,
  fields,
}: GridActiveFiltersProps<Row> = {}) {
  const instance = useGridInstance<Row>();
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  const filters = useGridSelector<Row, GridFilterGroup>((state) => state.query.filters);
  const facets = useGridSelector<Row, ReturnType<typeof instance.getState>['data']['facets']>(
    (state) => state.data.facets,
  );
  const conditions = flattenConditions(filters);
  const editableFieldIds = fields ? new Set(fields.map((field) => field.id)) : undefined;
  const editableCount = editableFieldIds
    ? conditions.filter(({ condition }) => editableFieldIds.has(condition.fieldId)).length
    : conditions.length;
  if (!conditions.length) return null;
  return (
    <div className="hui-grid__active-filters">
      {conditions.slice(0, maxVisible).map(({ condition, groups }) => {
        const field = instance.definition.fieldMap.get(condition.fieldId);
        const options = field
          ? Array.isArray(field.options)
            ? field.options
            : facets?.[field.id]
          : undefined;
        const labelValue = (item: unknown) => {
          const option = options?.find((candidate) =>
            Object.is(candidate.value, activeOptionIdentity(item)),
          );
          return option ? gridNodeText(option.label) || safeGridText(item) : safeGridText(item);
        };
        const value = Array.isArray(condition.value)
          ? condition.value.map(labelValue).join(', ')
          : labelValue(condition.value);
        const groupLabel = groups
          .map(
            (group) =>
              `${group.negated ? `${locale.not} ` : ''}${
                group.logic === 'or' ? locale.anyCondition : locale.allConditions
              }`,
          )
          .join(' › ');
        const editable = !editableFieldIds || editableFieldIds.has(condition.fieldId);
        return (
          <Tag
            key={condition.id}
            closable={editable}
            onClose={
              editable
                ? (event) => {
                    event.preventDefault();
                    instance.query.setFilters(removeFilterNode(filters, condition.id), 'user');
                  }
                : undefined
            }
          >
            {groupLabel ? `${groupLabel} · ` : ''}
            {field ? gridNodeText(field.title) || field.id : condition.fieldId} ·{' '}
            {locale.operatorLabel(condition.operator)}
            {value ? ` · ${value}` : ''}
          </Tag>
        );
      })}
      {conditions.length > maxVisible && <span>+{conditions.length - maxVisible}</span>}
      {editableCount > 0 && (
        <Button
          size="small"
          type="link"
          onClick={() => {
            if (!editableFieldIds) {
              instance.query.setFilters(createFilterGroup(), 'user');
              return;
            }
            const protectedFilters = removeEditableFilterConditions(filters, editableFieldIds);
            instance.query.setFilters(
              countFilterConditions(protectedFilters) ? protectedFilters : createFilterGroup(),
              'user',
            );
          }}
        >
          {locale.clear}
        </Button>
      )}
      <span className="hui-grid__filter-count" aria-hidden>
        {countFilterConditions(filters)}
      </span>
    </div>
  );
}
