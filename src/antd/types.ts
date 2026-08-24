import type { Locale as AntdLocale } from 'antd/es/locale';
import type { TableProps, ThemeConfig } from 'antd';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import type {
  GridEvent,
  GridFilterOperator,
  GridInstance,
  GridOptions,
  GridResolvedColumn,
  GridResolvedField,
  GridState,
  GridTotal,
} from '../core';

export interface GridRowInteractionContext<Row extends object> {
  row: Row;
  rowIndex: number;
  instance: GridInstance<Row>;
}

export interface GridRowClickContext<Row extends object> extends GridRowInteractionContext<Row> {
  event: MouseEvent<HTMLElement>;
}

export interface GridCellInteractionContext<
  Row extends object,
> extends GridRowInteractionContext<Row> {
  column: GridResolvedColumn<Row>;
  field?: GridResolvedField<Row>;
  value: unknown;
}

export interface GridCellClickContext<Row extends object> extends GridCellInteractionContext<Row> {
  event: MouseEvent<HTMLElement>;
}

export interface GridLocale {
  searchPlaceholder: string;
  fields: string;
  filters: string;
  sorts: string;
  views: string;
  refresh: string;
  density: string;
  compact: string;
  standard: string;
  comfortable: string;
  noData: string;
  noResults: string;
  retry: string;
  actions: string;
  more: string;
  apply: string;
  clear: string;
  cancel: string;
  reset: string;
  addCondition: string;
  addGroup: string;
  addSort: string;
  allConditions: string;
  anyCondition: string;
  noConditions: string;
  noSorts: string;
  noFields: string;
  fieldSearch: string;
  defaultView: string;
  newView: string;
  viewName: string;
  rename: string;
  duplicate: string;
  save: string;
  remove: string;
  selectAll: (count: number) => string;
  total: (count: number, accuracy?: GridTotal['accuracy']) => string;
  selected: (count: number) => string;
  page: (page: number) => string;
  pageSize: (size: number) => string;
  required: string;
  saveFailed: string;
  loadingOptions: string;
  previousPage: string;
  nextPage: string;
  pinLeft: string;
  pinRight: string;
  unpin: string;
  showColumn: string;
  hideColumn: string;
  resizeColumn: (title: string) => string;
  sortAscending: string;
  sortDescending: string;
  nullsFirst: string;
  nullsLast: string;
  filterNoValue: string;
  deleteCondition: string;
  moveUp: string;
  moveDown: string;
  editCell: (title: string) => string;
  operatorLabel: (operator: GridFilterOperator) => string;
  not: string;
  minimum: string;
  maximum: string;
  yes: string;
  no: string;
  trueLabel: string;
  falseLabel: string;
  invalidJson: string;
  renderFailed: string;
}

export interface GridToolbarFeatures {
  views?: boolean;
  columns?: boolean;
  filters?: boolean;
  sorts?: boolean;
  search?: boolean;
  refresh?: boolean;
  density?: boolean;
  actions?: boolean;
}

export interface GridRowActionsConfig {
  width?: number;
  maxVisible?: number;
  title?: ReactNode;
}

export type GridTableSelectionProps<Row extends object> = Omit<
  NonNullable<TableProps<Row>['rowSelection']>,
  'selectedRowKeys' | 'defaultSelectedRowKeys' | 'preserveSelectedRowKeys'
>;

export interface GridFooterFeatures {
  selection?: boolean;
  summary?: boolean;
  total?: boolean;
  pagination?: boolean;
}

export interface GridUiConfig<Row extends object> {
  locale?: Partial<GridLocale>;
  language?: string;
  timeZone?: string;
  theme?: ThemeConfig;
  antdLocale?: AntdLocale;
  pageSizeOptions?: number[];
  selection?: boolean | GridTableSelectionProps<Row>;
  tableProps?: GridTablePlatformProps<Row>;
  onRowClick?: (context: GridRowClickContext<Row>) => void;
  onCellClick?: (context: GridCellClickContext<Row>) => void;
  isRowClickable?: (context: GridRowInteractionContext<Row>) => boolean;
  isCellClickable?: (context: GridCellInteractionContext<Row>) => boolean;
  renderEmpty?: (context: { filtered: boolean; instance: GridInstance<Row> }) => ReactNode;
  renderError?: (error: Error, instance: GridInstance<Row>) => ReactNode;
}

export type GridTablePlatformProps<Row extends object> = Omit<
  TableProps<Row>,
  'columns' | 'dataSource' | 'rowKey' | 'loading' | 'pagination' | 'rowSelection' | 'onChange'
> & { onChange?: TableProps<Row>['onChange'] };

export interface DataGridProps<Row extends object> extends GridOptions<Row>, GridUiConfig<Row> {
  toolbar?: false | GridToolbarFeatures;
  footer?: false | GridFooterFeatures;
  rowActions?: false | GridRowActionsConfig;
  children?: ReactNode | ((instance: GridInstance<Row>) => ReactNode);
  beforeTable?: ReactNode;
  afterTable?: ReactNode;
  className?: string;
  style?: CSSProperties;
  onEvent?: (event: GridEvent, state: GridState<Row>) => void;
}

export interface GridRenderContext<Row extends object> {
  instance: GridInstance<Row>;
  state: GridState<Row>;
}

export interface GridFieldRenderContext<Row extends object> extends GridRenderContext<Row> {
  field: GridResolvedField<Row>;
}
