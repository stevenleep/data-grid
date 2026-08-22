import { ColumnHeightOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Dropdown, Input, Pagination, Select, Space, Tag, Tooltip } from 'antd';
import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import {
  countFilterConditions,
  removeFilterNode,
  type GridDensity,
  type GridFilterCondition,
  type GridFilterGroup,
  type GridSummaryValue,
  type GridTotal as GridTotalValue,
} from '../core';
import { useGridInstance, useGridSelector } from '../react';
import { useGridUi } from './context';
import { resolveGridLocale } from './locale';
import { operatorLabel } from './operators';

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
  const external = controlled ?? keyword;
  const [value, setValue] = useState(external);
  const mounted = useRef(false);

  useEffect(() => setValue(external), [external]);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const timer = setTimeout(
      () => {
        const next = value.trim();
        if (onChange) onChange(next);
        else if (next !== keyword) instance.query.setKeyword(next, 'user');
      },
      Math.max(0, debounce),
    );
    return () => clearTimeout(timer);
  }, [debounce, instance, keyword, onChange, value]);

  return (
    <Input
      className={classes('hui-grid__search', className)}
      size="small"
      allowClear
      prefix={<SearchOutlined />}
      value={value}
      style={width ? { width } : undefined}
      placeholder={placeholder || locale.searchPlaceholder}
      disabled={disabled ?? (!onChange && !instance.capabilities.search)}
      onChange={(event) => setValue(event.target.value)}
      onPressEnter={() => {
        const next = value.trim();
        if (onChange) onChange(next);
        else instance.query.setKeyword(next, 'user');
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
            <span key={index}>{warning as ReactNode}</span>
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
              <span>{item.label as ReactNode}</span>
              <strong>
                {(item.render ? item.render(item.value, item) : item.value) as ReactNode}
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
  const count =
    selection.mode === 'explicit'
      ? selection.selectedKeys.length
      : Math.max(0, selection.total - selection.excludedKeys.length);
  if (!count) return null;
  const canSelectAll =
    allowSelectAll &&
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
    return (
      <Space size={8}>
        {sizeSelect}
        <Button
          size="small"
          disabled={!data.pageInfo?.hasPrevious}
          onClick={() =>
            instance.query.goToCursor(data.pageInfo?.previousCursor, 'backward', 'user')
          }
        >
          {locale.previousPage}
        </Button>
        <Button
          size="small"
          disabled={!data.pageInfo?.hasNext}
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

  return (
    <Space size={8}>
      {sizeSelect}
      <Button
        size="small"
        disabled={pagination.page <= 1 || data.pageInfo?.hasPrevious === false}
        onClick={() => instance.query.setPage(pagination.page - 1, 'user')}
      >
        {locale.previousPage}
      </Button>
      <span>{locale.page(pagination.page)}</span>
      <Button
        size="small"
        disabled={data.pageInfo?.hasNext === false}
        onClick={() => instance.query.setPage(pagination.page + 1, 'user')}
      >
        {locale.nextPage}
      </Button>
    </Space>
  );
}

function flattenConditions(group: GridFilterGroup): GridFilterCondition[] {
  return group.children.flatMap((node) =>
    node.type === 'group' ? flattenConditions(node) : [node],
  );
}

export interface GridActiveFiltersProps {
  maxVisible?: number;
}

export function GridActiveFilters<Row extends object>({
  maxVisible = 8,
}: GridActiveFiltersProps = {}) {
  const instance = useGridInstance<Row>();
  const ui = useGridUi<Row>();
  const locale = resolveGridLocale(ui.locale, ui.language);
  const filters = useGridSelector<Row, GridFilterGroup>((state) => state.query.filters);
  const conditions = flattenConditions(filters);
  if (!conditions.length) return null;
  return (
    <div className="hui-grid__active-filters">
      {conditions.slice(0, maxVisible).map((condition) => {
        const field = instance.definition.fieldMap.get(condition.fieldId);
        const value = Array.isArray(condition.value)
          ? condition.value.join(', ')
          : String(condition.value ?? '');
        return (
          <Tag
            key={condition.id}
            closable
            onClose={(event) => {
              event.preventDefault();
              instance.query.setFilters(removeFilterNode(filters, condition.id), 'user');
            }}
          >
            {String(field?.title ?? condition.fieldId)} ·{' '}
            {operatorLabel(condition.operator, ui.language)}
            {value ? ` · ${value}` : ''}
          </Tag>
        );
      })}
      {conditions.length > maxVisible && <span>+{conditions.length - maxVisible}</span>}
      <Button
        size="small"
        type="link"
        onClick={() => instance.query.setFilters({ ...filters, children: [] }, 'user')}
      >
        {locale.clear}
      </Button>
      <span className="hui-grid__filter-count" aria-hidden>
        {countFilterConditions(filters)}
      </span>
    </div>
  );
}
