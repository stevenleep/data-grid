import type { Locale as AntdLocale } from 'antd/es/locale';
import type { TableProps, ThemeConfig } from 'antd';
import type { ComponentType, CSSProperties, ErrorInfo, MouseEvent, ReactNode } from 'react';
import type {
  GridCellContext,
  GridEditorContext,
  GridEvent,
  GridFilterOperator,
  GridInstance,
  GridOptions,
  GridResolvedColumn,
  GridResolvedField,
  GridState,
} from '../core';

/** React component used to present every field of a registered value type. */
export type GridCellRendererComponent<Row extends object, Value = unknown> = ComponentType<
  GridCellContext<Row, Value>
>;

/** React component used for a registered editor name or value type. */
export type GridCellEditorComponent<Row extends object, Value = unknown> = ComponentType<
  GridEditorContext<Row, Value>
>;

/** Heterogeneous presentation registry; field-level renderers still take precedence. */
export type GridCellRendererRegistry<Row extends object> = Readonly<
  Record<string, GridCellRendererComponent<Row, any>>
>;

/** Heterogeneous editor registry; keys may be value types or `edit.editor` names. */
export type GridCellEditorRegistry<Row extends object> = Readonly<
  Record<string, GridCellEditorComponent<Row, any>>
>;

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
  total: (count: number, accuracy?: 'exact' | 'estimated' | 'atLeast') => string;
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
  filterCapabilityConflict: string;
  sortCapabilityConflict: string;
  defaultNullPlacement: string;
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

/**
 * Composes one region of the default DataGrid layout. Return `defaultContent`
 * with additions to decorate it, or ignore it to replace the region.
 */
export type DataGridSlotRenderer<Row extends object> = (
  defaultContent: ReactNode,
  instance: GridInstance<Row>,
) => ReactNode;

/** A direct node replaces the region; a renderer can wrap or replace its default content. */
export type DataGridSlot<Row extends object> = ReactNode | DataGridSlotRenderer<Row>;

export interface DataGridSlots<Row extends object> {
  toolbar?: DataGridSlot<Row>;
  activeFilters?: DataGridSlot<Row>;
  status?: DataGridSlot<Row>;
  table?: DataGridSlot<Row>;
  footer?: DataGridSlot<Row>;
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
  cellRenderers?: GridCellRendererRegistry<Row>;
  cellEditors?: GridCellEditorRegistry<Row>;
  renderEmpty?: (context: { filtered: boolean; instance: GridInstance<Row> }) => ReactNode;
  renderError?: (error: Error, instance: GridInstance<Row>) => ReactNode;
  onRenderError?: (error: Error, info: ErrorInfo) => void;
}

export type GridTablePlatformProps<Row extends object> = Omit<
  TableProps<Row>,
  'columns' | 'dataSource' | 'rowKey' | 'loading' | 'pagination' | 'rowSelection' | 'onChange'
> & { onChange?: TableProps<Row>['onChange'] };

/** Presentation and composition props shared by DataGrid and DataGridView. */
export interface DataGridPresentationProps<Row extends object> extends GridUiConfig<Row> {
  toolbar?: false | GridToolbarFeatures;
  footer?: false | GridFooterFeatures;
  rowActions?: false | GridRowActionsConfig;
  slots?: DataGridSlots<Row>;
  children?: ReactNode | ((instance: GridInstance<Row>) => ReactNode);
  beforeTable?: ReactNode;
  afterTable?: ReactNode;
  className?: string;
  style?: CSSProperties;
  onEvent?: (event: GridEvent, state: GridState<Row>) => void;
}

export interface DataGridProps<Row extends object>
  extends GridOptions<Row>, DataGridPresentationProps<Row> {}

export interface DataGridViewProps<Row extends object> extends DataGridPresentationProps<Row> {
  /** Existing instance owned by the caller. DataGridView never starts, stops or updates it. */
  grid: GridInstance<Row>;
}

export interface GridRenderContext<Row extends object> {
  instance: GridInstance<Row>;
  state: GridState<Row>;
}

export interface GridFieldRenderContext<Row extends object> extends GridRenderContext<Row> {
  field: GridResolvedField<Row>;
}
