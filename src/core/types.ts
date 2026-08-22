export type GridPrimitive = string | number | boolean | null;
export type GridJsonValue = GridPrimitive | GridJsonValue[] | { [key: string]: GridJsonValue };
export type GridPath = readonly (string | number)[];
export type GridRowKey = string | number;
export type GridNode = unknown;

export type GridBuiltinValueType =
  | 'text'
  | 'longText'
  | 'number'
  | 'decimal'
  | 'money'
  | 'percent'
  | 'boolean'
  | 'select'
  | 'multiSelect'
  | 'status'
  | 'date'
  | 'dateTime'
  | 'duration'
  | 'link'
  | 'email'
  | 'phone'
  | 'user'
  | 'relation'
  | 'image'
  | 'file'
  | 'json';

export type GridValueType = GridBuiltinValueType | (string & {});

export type GridFilterOperator =
  | 'contains'
  | 'notContains'
  | 'equals'
  | 'notEquals'
  | 'startsWith'
  | 'endsWith'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'between'
  | 'notBetween'
  | 'in'
  | 'notIn'
  | 'containsAny'
  | 'containsAll'
  | 'containsNone'
  | 'before'
  | 'after'
  | 'onOrBefore'
  | 'onOrAfter'
  | 'today'
  | 'yesterday'
  | 'tomorrow'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'last7Days'
  | 'last30Days'
  | 'isTrue'
  | 'isFalse'
  | 'isEmpty'
  | 'isNotEmpty'
  | (string & {});

export type GridFilterValueKind = 'none' | 'single' | 'multiple' | 'range';
export type GridFilterOperatorValueKinds = Partial<Record<GridFilterOperator, GridFilterValueKind>>;

export interface GridOption<Label = GridNode> {
  label: Label;
  value: GridPrimitive;
  color?: string;
  disabled?: boolean;
  description?: Label;
  meta?: Record<string, unknown>;
}

export interface GridOptionSchema {
  label: string;
  value: GridPrimitive;
  color?: string;
  disabled?: boolean;
  description?: string;
  meta?: Record<string, GridJsonValue>;
}

export interface GridFilterCondition {
  id: string;
  type: 'condition';
  fieldId: string;
  operator: GridFilterOperator;
  value?: GridJsonValue;
}

export interface GridFilterGroup {
  id: string;
  type: 'group';
  logic: 'and' | 'or';
  negated?: boolean;
  children: Array<GridFilterGroup | GridFilterCondition>;
}

export interface GridSort {
  id: string;
  fieldId: string;
  direction: 'asc' | 'desc';
  nulls?: 'first' | 'last';
}

export interface GridOffsetPagination {
  type: 'offset';
  page: number;
  pageSize: number;
}

export interface GridCursorPagination {
  type: 'cursor';
  pageSize: number;
  cursor?: string;
  direction?: 'forward' | 'backward';
}

export type GridPagination = GridOffsetPagination | GridCursorPagination;

export interface GridQuery {
  pagination: GridPagination;
  keyword: string;
  filters: GridFilterGroup;
  sorts: GridSort[];
  projection?: string[];
  context?: Record<string, GridJsonValue>;
}

export interface GridRequestFilterCondition {
  field: string;
  operator: GridFilterOperator;
  value?: GridJsonValue;
}

export interface GridRequestFilterGroup {
  logic: 'and' | 'or';
  negated?: boolean;
  children: Array<GridRequestFilterGroup | GridRequestFilterCondition>;
}

export interface GridRequestSort {
  field: string;
  direction: 'asc' | 'desc';
  nulls?: 'first' | 'last';
}

export interface GridRequestQuery {
  pagination: GridPagination;
  keyword?: string;
  filter?: GridRequestFilterGroup;
  sort?: GridRequestSort[];
  select?: string[];
  context?: Record<string, GridJsonValue>;
}

export interface GridValueCodec<Value = unknown> {
  encode: (value: Value) => GridJsonValue | undefined;
  decode: (value: GridJsonValue | undefined) => Value;
}

export interface GridCellContext<Row extends object, Value = unknown> {
  value: Value;
  row: Row;
  rowIndex: number;
  field: GridResolvedField<Row, Value>;
  instance: GridInstance<Row>;
}

export interface GridEditorContext<Row extends object, Value = unknown> extends GridCellContext<
  Row,
  Value
> {
  draft: Value;
  saving: boolean;
  error?: string;
  setDraft: (value: Value) => void;
  commit: () => Promise<boolean>;
  cancel: () => void;
}

export interface GridFilterEditorContext<Row extends object, Value = GridJsonValue | undefined> {
  field: GridResolvedField<Row>;
  operator: GridFilterOperator;
  valueKind: GridFilterValueKind;
  value: Value;
  onChange: (value: Value) => void;
  instance: GridInstance<Row>;
}

export type GridCellRenderer<Row extends object, Value = unknown> = (
  context: GridCellContext<Row, Value>,
) => GridNode;

export interface GridColumnCellContext<Row extends object> {
  value: unknown;
  row: Row;
  rowIndex: number;
  column: GridResolvedColumn<Row>;
  field?: GridResolvedField<Row>;
  instance: GridInstance<Row>;
}

export type GridColumnRenderer<Row extends object> = (
  context: GridColumnCellContext<Row>,
) => GridNode;

export type GridEditorRenderer<Row extends object, Value = unknown> = (
  context: GridEditorContext<Row, Value>,
) => GridNode;

export type GridFilterEditorRenderer<Row extends object> = (
  context: GridFilterEditorContext<Row>,
) => GridNode;

export interface GridValueTypeDefinition<Row extends object = object, Value = unknown> {
  defaultColumn?: GridColumnDisplay;
  operators?: GridFilterOperator[];
  /** Value arity for custom operators; field-level declarations take precedence. */
  operatorValueKinds?: GridFilterOperatorValueKinds;
  codec?: GridValueCodec<Value>;
  normalize?: (value: unknown, row: Row) => Value;
  equals?: (left: Value, right: Value) => boolean;
  isEmpty?: (value: Value) => boolean;
  compare?: (left: Value, right: Value, leftRow: Row, rightRow: Row) => number;
  searchText?: (value: Value, row: Row) => string;
  filterPredicate?: (value: Value, condition: GridFilterCondition, row: Row) => boolean | undefined;
  cell?: GridCellRenderer<Row, Value>;
  editor?: GridEditorRenderer<Row, Value>;
  filterEditor?: GridFilterEditorRenderer<Row>;
}

export interface GridFieldTransport<Value = unknown> {
  filterKey?: string;
  sortKey?: string;
  selectKey?: string;
  /** Raw transport select keys required to materialize this field. */
  selectDependencies?: readonly string[];
  encodeFilter?: (
    value: GridJsonValue | undefined,
    operator: GridFilterOperator,
  ) => GridJsonValue | undefined;
  encodeValue?: (value: Value) => GridJsonValue | undefined;
}

export interface GridFieldFilter {
  enabled?: boolean;
  operators?: GridFilterOperator[];
  /** Overrides value-type and built-in value arity for individual operators. */
  operatorValueKinds?: GridFilterOperatorValueKinds;
  defaultOperator?: GridFilterOperator;
  placeholder?: string;
}

export interface GridFieldSort {
  enabled?: boolean;
  defaultDirection?: 'asc' | 'desc';
  nulls?: boolean;
}

export interface GridFieldEdit {
  enabled?: boolean;
  required?: boolean;
  editor?: string;
  placeholder?: string;
}

export interface GridOptionLoadContext<Row extends object> {
  field: GridResolvedField<Row>;
  query: GridQuery;
  search: string;
  signal: AbortSignal;
}

export type GridOptionLoader<Row extends object> = (
  context: GridOptionLoadContext<Row>,
) => Promise<GridOption[]>;

export interface GridOptionProvider<Row extends object> {
  load: GridOptionLoader<Row>;
  cacheTime?: number;
  dependsOn?: 'query' | string[];
}

export type GridFieldOptions<Row extends object> =
  GridOption[] | GridOptionLoader<Row> | GridOptionProvider<Row>;

export interface GridColumnDisplay {
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  align?: 'left' | 'center' | 'right';
  fixed?: 'left' | 'right';
  hidden?: boolean;
  hideable?: boolean;
  reorderable?: boolean;
  resizable?: boolean;
  pinnable?: boolean;
  ellipsis?: boolean;
  wrap?: boolean;
}

export interface GridFieldDefinition<Row extends object, Value = unknown> {
  id: string;
  title: GridNode;
  valueType?: GridValueType;
  path?: GridPath;
  accessor?: (row: Row) => Value;
  normalize?: (value: unknown, row: Row) => Value;
  transport?: GridFieldTransport<Value>;
  filter?: boolean | GridFieldFilter;
  sort?: boolean | GridFieldSort;
  edit?: boolean | GridFieldEdit;
  options?: GridFieldOptions<Row>;
  description?: GridNode;
  column?: false | GridColumnDisplay;
  compare?: GridValueTypeDefinition<Row, Value>['compare'];
  searchText?: GridValueTypeDefinition<Row, Value>['searchText'];
  filterPredicate?: GridValueTypeDefinition<Row, Value>['filterPredicate'];
  validate?: (value: Value, row: Row) => void | string | Promise<void | string>;
  render?: GridCellRenderer<Row, Value>;
  editor?: GridEditorRenderer<Row, Value>;
  filterEditor?: GridFilterEditorRenderer<Row>;
  meta?: Record<string, unknown>;
}

/** A field entry for heterogeneous definition collections. Preserve `Value` with field helpers. */
export type GridAnyFieldDefinition<Row extends object> = GridFieldDefinition<Row, any>;

export interface GridColumnDefinition<Row extends object> extends GridColumnDisplay {
  id: string;
  fieldId?: string;
  title?: GridNode;
  description?: GridNode;
  children?: readonly GridColumnDefinition<Row>[];
  render?: GridColumnRenderer<Row>;
  header?: (column: GridResolvedColumn<Row>, instance: GridInstance<Row>) => GridNode;
  meta?: Record<string, unknown>;
  platform?: unknown;
}

export interface GridResolvedField<Row extends object, Value = unknown> {
  id: string;
  title: GridNode;
  valueType: GridValueType;
  path: GridPath;
  transport: Required<Pick<GridFieldTransport<Value>, 'filterKey' | 'sortKey' | 'selectKey'>> &
    GridFieldTransport<Value>;
  filter: false | (Required<Pick<GridFieldFilter, 'enabled'>> & GridFieldFilter);
  sort: false | (Required<Pick<GridFieldSort, 'enabled'>> & GridFieldSort);
  edit: false | (Required<Pick<GridFieldEdit, 'enabled'>> & GridFieldEdit);
  options?: GridFieldOptions<Row>;
  description?: GridNode;
  getValue: (row: Row) => Value;
  normalize: (value: unknown, row: Row) => Value;
  equals: (left: Value, right: Value) => boolean;
  isEmpty: (value: Value) => boolean;
  compare?: GridValueTypeDefinition<Row, Value>['compare'];
  searchText?: GridValueTypeDefinition<Row, Value>['searchText'];
  filterPredicate?: GridValueTypeDefinition<Row, Value>['filterPredicate'];
  validate?: GridFieldDefinition<Row, Value>['validate'];
  render?: GridCellRenderer<Row, Value>;
  editor?: GridEditorRenderer<Row, Value>;
  filterEditor?: GridFilterEditorRenderer<Row>;
  meta?: Record<string, unknown>;
}

/** A resolved field entry for heterogeneous runtime collections. */
export type GridAnyResolvedField<Row extends object> = GridResolvedField<Row, any>;

export interface GridResolvedColumn<Row extends object> extends GridColumnDisplay {
  id: string;
  fieldId?: string;
  title: GridNode;
  description?: GridNode;
  children?: GridResolvedColumn<Row>[];
  render?: GridColumnRenderer<Row>;
  header?: GridColumnDefinition<Row>['header'];
  platform?: unknown;
}

export interface GridFieldSchema {
  id: string;
  title: string;
  valueType?: GridValueType;
  path?: GridPath;
  transport?: Omit<GridFieldTransport, 'encodeFilter' | 'encodeValue'>;
  filter?: boolean | GridFieldFilter;
  sort?: boolean | GridFieldSort;
  edit?: boolean | GridFieldEdit;
  description?: string;
  column?: false | GridColumnDisplay;
  options?:
    | { type: 'static'; items: GridOptionSchema[] }
    | { type: 'runtime'; loader: string; cacheTime?: number; dependsOn?: 'query' | string[] };
  renderer?: string;
  editor?: string;
  filterEditor?: string;
  meta?: Record<string, GridJsonValue>;
}

export interface GridColumnSchema extends GridColumnDisplay {
  id: string;
  fieldId?: string;
  title?: string;
  description?: string;
  children?: GridColumnSchema[];
  renderer?: string;
  header?: string;
  meta?: Record<string, GridJsonValue>;
}

export interface GridActionSchema {
  id: string;
  label: string;
  handler: string;
  placement?: GridActionPlacement;
  intent?: GridActionIntent;
  confirm?: string;
  refresh?: boolean;
  order?: number;
  group?: string;
}

export interface GridSchema {
  protocol: 'huiyun.data-grid/v1';
  id: string;
  revision: string | number;
  projection?: GridProjectionDefinition;
  fields: GridFieldSchema[];
  columns?: GridColumnSchema[];
  actions?: GridActionSchema[];
  defaults?: GridFeatureDefaults;
  meta?: Record<string, GridJsonValue>;
}

export interface GridFieldRuntime<Row extends object, Value = unknown> {
  title?: GridNode;
  accessor?: (row: Row) => Value;
  normalize?: (value: unknown, row: Row) => Value;
  transport?: Pick<GridFieldTransport<Value>, 'encodeFilter' | 'encodeValue'>;
  options?: GridFieldOptions<Row>;
  compare?: GridFieldDefinition<Row, Value>['compare'];
  searchText?: GridFieldDefinition<Row, Value>['searchText'];
  filterPredicate?: GridFieldDefinition<Row, Value>['filterPredicate'];
  validate?: GridFieldDefinition<Row, Value>['validate'];
  render?: GridCellRenderer<Row, Value>;
  editor?: GridEditorRenderer<Row, Value>;
  filterEditor?: GridFilterEditorRenderer<Row>;
}

export interface GridRuntime<Row extends object> {
  fields?: Record<string, GridFieldRuntime<Row>>;
  renderers?: Record<string, GridCellRenderer<Row>>;
  columnRenderers?: Record<string, GridColumnRenderer<Row>>;
  editors?: Record<string, GridEditorRenderer<Row>>;
  filterEditors?: Record<string, GridFilterEditorRenderer<Row>>;
  optionLoaders?: Record<string, GridOptionLoader<Row>>;
  columnHeaders?: Record<string, GridColumnDefinition<Row>['header']>;
  actionHandlers?: Record<string, GridActionHandler<Row>>;
  actions?: Record<string, GridActionRuntime<Row>>;
  editing?: GridEditing<Row>;
  valueTypes?: Record<string, GridValueTypeDefinition<Row>>;
}

export type GridActionPlacement = 'toolbar' | 'row' | 'bulk' | 'cell';
export type GridActionIntent = 'default' | 'primary' | 'danger';

export interface GridActionContext<Row extends object> {
  instance: GridInstance<Row>;
  query: GridQuery;
  request: GridRequestQuery;
  selection: GridSelectionState;
  selectedRows: Row[];
  row?: Row;
  field?: GridResolvedField<Row>;
  value?: unknown;
  signal: AbortSignal;
}

export type GridActionHandler<Row extends object> = (
  context: GridActionContext<Row>,
) => void | Promise<void>;

export interface GridAction<Row extends object> {
  id: string;
  label: GridNode;
  placement?: GridActionPlacement;
  icon?: GridNode;
  intent?: GridActionIntent;
  order?: number;
  group?: string;
  confirm?: GridNode;
  getConfirmation?: (context: Omit<GridActionContext<Row>, 'signal'>) => GridNode;
  refresh?: boolean;
  visible?: boolean | ((context: Omit<GridActionContext<Row>, 'signal'>) => boolean);
  disabled?: boolean | ((context: Omit<GridActionContext<Row>, 'signal'>) => boolean);
  run: GridActionHandler<Row>;
}

export type GridActionRuntime<Row extends object> = Partial<Omit<GridAction<Row>, 'id' | 'run'>> & {
  run?: GridActionHandler<Row>;
};

export interface GridEditInput<Row extends object> {
  row: Row;
  rowKey: GridRowKey;
  field: GridResolvedField<Row>;
  previousValue: unknown;
  value: unknown;
  signal: AbortSignal;
  instance: GridInstance<Row>;
}

export interface GridEditResult<Row extends object> {
  type: 'grid-edit-result';
  row?: Row;
  reload?: boolean;
}

export interface GridEditing<Row extends object> {
  canEdit?: (row: Row, field: GridResolvedField<Row>) => boolean;
  reloadOnSave?: boolean;
  apply?: (row: Row, field: GridResolvedField<Row>, value: unknown) => Row;
  optimistic?: boolean;
  save: (input: GridEditInput<Row>) => Promise<void | Row | GridEditResult<Row>>;
}

export interface GridFeatureDefaults {
  pageSize?: number;
  density?: GridDensity;
  selection?: boolean;
  views?: boolean;
}

export interface GridProjectionDefinition {
  /**
   * Raw transport select key(s) needed to resolve a functional or differently mapped row key.
   * String/path row keys are inferred when this is omitted.
   */
  rowKey?: string | readonly string[];
  /** Semantic field ids that must be returned even when their columns are hidden. */
  requiredFields?: readonly string[];
  /** Additional raw transport select keys required by renderers, permissions or actions. */
  requiredKeys?: readonly string[];
}

export interface GridDefinition<Row extends object> {
  id: string;
  revision?: string | number;
  rowKey: string | GridPath | ((row: Row) => GridRowKey);
  projection?: GridProjectionDefinition;
  fields: readonly GridAnyFieldDefinition<Row>[];
  columns?: readonly GridColumnDefinition<Row>[];
  valueTypes?: Record<string, GridValueTypeDefinition<Row>>;
  actions?: readonly GridAction<Row>[];
  editing?: GridEditing<Row>;
  defaults?: GridFeatureDefaults;
  meta?: Record<string, unknown>;
}

export interface GridResolvedDefinition<Row extends object> extends Omit<
  GridDefinition<Row>,
  'fields' | 'columns' | 'revision'
> {
  revision: string | number;
  fields: GridAnyResolvedField<Row>[];
  columns: GridResolvedColumn<Row>[];
  fieldMap: ReadonlyMap<string, GridAnyResolvedField<Row>>;
  columnMap: ReadonlyMap<string, GridResolvedColumn<Row>>;
  getRowKey: (row: Row) => GridRowKey;
}

export type GridFilterLogicCapability = 'and' | 'flat' | 'nested';

export interface GridCapabilities {
  pagination?: 'offset' | 'cursor';
  search?: boolean;
  filter?: {
    logic?: GridFilterLogicCapability;
    negation?: boolean;
    maxDepth?: number;
    maxConditions?: number;
    operators?: GridFilterOperator[];
  };
  sort?: {
    max?: number;
    nulls?: boolean;
  };
  projection?: boolean;
  summary?: boolean;
  facets?: boolean;
  selectAllMatching?: boolean;
}

export interface GridResolvedCapabilities {
  pagination: 'offset' | 'cursor';
  search: boolean;
  filter: {
    logic: GridFilterLogicCapability;
    negation: boolean;
    maxDepth: number;
    maxConditions: number;
    operators?: GridFilterOperator[];
  };
  sort: {
    max: number;
    nulls: boolean;
  };
  projection: boolean;
  summary: boolean;
  facets: boolean;
  selectAllMatching: boolean;
}

export interface GridTotal {
  value: number;
  accuracy?: 'exact' | 'estimated' | 'atLeast';
}

export interface GridPageInfo {
  hasNext?: boolean;
  hasPrevious?: boolean;
  nextCursor?: string;
  previousCursor?: string;
}

export interface GridSummaryValue {
  id: string;
  label: GridNode;
  value: unknown;
  fieldId?: string;
  aggregate?: 'count' | 'sum' | 'average' | 'min' | 'max' | (string & {});
  scope?: 'page' | 'query' | 'selection' | 'dataset';
  render?: (value: unknown, item: GridSummaryValue) => GridNode;
}

export interface GridReadResult<Row extends object> {
  rows: readonly Row[];
  total?: GridTotal;
  pageInfo?: GridPageInfo;
  summary?: GridSummaryValue[];
  facets?: Record<string, GridOption[]>;
  warnings?: GridNode[];
  snapshotId?: string;
  meta?: Record<string, unknown>;
}

export type GridRequestReason =
  'initial' | 'query' | 'pagination' | 'refresh' | 'projection' | 'source';

export interface GridReadInput<Row extends object> {
  query: GridQuery;
  request: GridRequestQuery;
  fields: readonly GridResolvedField<Row>[];
  signal: AbortSignal;
  requestId: number;
  reason: GridRequestReason;
}

export interface GridRemoteSource<Row extends object> {
  mode: 'remote';
  read: (input: GridReadInput<Row>) => Promise<GridReadResult<Row>>;
  capabilities?: GridCapabilities;
  policy?: {
    cacheTime?: number;
    staleTime?: number;
    maxCacheEntries?: number;
    keepPreviousData?: boolean;
  };
}

export interface GridLocalSource<Row extends object> {
  mode: 'local';
  rows: readonly Row[];
  capabilities?: GridCapabilities;
}

export interface GridControlledSource<Row extends object> {
  mode: 'controlled';
  result: GridReadResult<Row>;
  loading?: boolean;
  refreshing?: boolean;
  error?: unknown;
  capabilities?: GridCapabilities;
  onQueryChange?: (query: GridQuery, request: GridRequestQuery, event: GridEvent) => void;
}

export type GridDataSource<Row extends object> =
  GridRemoteSource<Row> | GridLocalSource<Row> | GridControlledSource<Row>;

export type GridDensity = 'compact' | 'default' | 'comfortable';

export interface GridColumnState {
  order: string[];
  hidden: string[];
  widths: Record<string, number>;
  pinned: Record<string, 'left' | 'right' | null>;
  density: GridDensity;
}

export type GridSelectionState =
  | { mode: 'explicit'; selectedKeys: GridRowKey[] }
  | {
      mode: 'allMatching';
      querySignature: string;
      excludedKeys: GridRowKey[];
      total: number;
    };

export interface GridDataState<Row extends object> extends GridReadResult<Row> {
  status: 'idle' | 'loading' | 'success' | 'error';
  fetching: boolean;
  error?: Error;
  requestId?: number;
  updatedAt?: number;
}

export interface GridView {
  id: string;
  name: string;
  scope?: 'private' | 'shared' | 'system';
  readonly?: boolean;
  owner?: string;
  query: Omit<GridQuery, 'pagination'>;
  columns: GridColumnState;
  createdAt: string;
  updatedAt: string;
  meta?: Record<string, GridJsonValue>;
}

export interface GridViewState {
  activeId?: string;
  items: GridView[];
  dirty: boolean;
}

export interface GridEditingState {
  active?: {
    rowKey: GridRowKey;
    fieldId: string;
    previousValue: unknown;
    draft: unknown;
  };
  saving: boolean;
  error?: string;
  /** Stable code adapters can translate without parsing the fallback message. */
  errorCode?: 'required' | 'validation' | 'saveFailed';
}

export interface GridActionState {
  pending: Record<string, boolean>;
  errors: Record<string, string | undefined>;
}

export interface GridState<Row extends object> {
  query: GridQuery;
  columns: GridColumnState;
  selection: GridSelectionState;
  data: GridDataState<Row>;
  views: GridViewState;
  editing: GridEditingState;
  actions: GridActionState;
}

export type GridStateSlice = keyof GridState<object>;
export type GridEventReason = 'user' | 'api' | 'source' | 'restore' | 'system';

export interface GridEvent {
  type: string;
  reason: GridEventReason;
  timestamp: number;
  detail?: Record<string, unknown>;
}

export type GridStateUpdater<Row extends object> =
  GridState<Row> | ((previous: GridState<Row>) => GridState<Row>);

export interface GridPersistedState {
  protocol: 'huiyun.data-grid/preferences/v1';
  gridId: string;
  revision: string | number;
  columns: GridColumnState;
  views: GridView[];
  activeViewId?: string;
  updatedAt: string;
}

export interface GridPersistenceContext<Row extends object> {
  definition: GridResolvedDefinition<Row>;
}

export interface GridPersistence<Row extends object = object> {
  load: (
    gridId: string,
    context: GridPersistenceContext<Row>,
  ) => Promise<GridPersistedState | null>;
  save: (
    gridId: string,
    state: GridPersistedState,
    context: GridPersistenceContext<Row>,
  ) => Promise<void>;
  clear?: (gridId: string, context: GridPersistenceContext<Row>) => Promise<void>;
  migrate?: (
    state: GridPersistedState,
    context: GridPersistenceContext<Row>,
  ) => Promise<GridPersistedState | null> | GridPersistedState | null;
}

export interface GridInitialState<Row extends object> {
  query?: Partial<Omit<GridQuery, 'pagination'>> & { pagination?: GridPagination };
  columns?: Partial<GridColumnState>;
  selection?: GridSelectionState;
  views?: Partial<GridViewState>;
  data?: Partial<GridDataState<Row>>;
}

export interface GridOptions<Row extends object> {
  definition: GridDefinition<Row> | GridResolvedDefinition<Row>;
  source: GridDataSource<Row>;
  state?: Partial<GridState<Row>>;
  defaultState?: GridInitialState<Row>;
  persistence?: GridPersistence<Row> | false;
  onStateChange?: (state: GridState<Row>, event: GridEvent) => void;
  onError?: (error: Error, event: GridEvent) => void;
}

export interface GridQueryApi {
  set: (query: GridQuery, reason?: GridEventReason) => void;
  update: (updater: (query: GridQuery) => GridQuery, reason?: GridEventReason) => void;
  setKeyword: (keyword: string, reason?: GridEventReason) => void;
  setFilters: (filters: GridFilterGroup, reason?: GridEventReason) => void;
  setSorts: (sorts: GridSort[], reason?: GridEventReason) => void;
  setPage: (page: number, reason?: GridEventReason) => void;
  setPageSize: (pageSize: number, reason?: GridEventReason) => void;
  goToCursor: (
    cursor: string | undefined,
    direction: 'forward' | 'backward',
    reason?: GridEventReason,
  ) => void;
  reset: (reason?: GridEventReason) => void;
  compile: () => GridRequestQuery;
}

export interface GridColumnsApi {
  getDefaultState: () => GridColumnState;
  setVisible: (columnId: string, visible: boolean) => void;
  setOrder: (columnIds: string[]) => void;
  setWidth: (columnId: string, width: number) => void;
  setPinned: (columnId: string, pinned: 'left' | 'right' | null) => void;
  setDensity: (density: GridDensity) => void;
  reset: () => void;
}

export interface GridSelectionApi<Row extends object> {
  set: (keys: readonly GridRowKey[], rows?: readonly Row[]) => void;
  toggle: (key: GridRowKey, row: Row, selected?: boolean) => void;
  selectPage: (rows?: readonly Row[]) => void;
  selectAllMatching: () => void;
  clear: () => void;
  isSelected: (key: GridRowKey) => boolean;
  getCount: () => number;
  getSelectedRows: () => Row[];
}

export interface GridDataApi<Row extends object> {
  reload: () => Promise<void>;
  invalidate: () => Promise<void>;
  updateRow: (key: GridRowKey, row: Row) => void;
  patchRow: (key: GridRowKey, patch: Partial<Row>) => void;
}

export interface GridViewsApi {
  create: (name: string, scope?: GridView['scope']) => GridView | undefined;
  rename: (id: string, name: string) => void;
  duplicate: (id: string, name?: string) => GridView | undefined;
  save: (id: string) => void;
  apply: (id?: string) => void;
  remove: (id: string) => void;
  reset: () => void;
}

export interface GridEditingApi<Row extends object> {
  canEdit: (row: Row, fieldId: string) => boolean;
  begin: (row: Row, fieldId: string) => void;
  setDraft: (value: unknown) => void;
  commit: () => Promise<boolean>;
  cancel: () => void;
}

export interface GridActionsApi<Row extends object> {
  list: (placement: GridActionPlacement, row?: Row) => GridAction<Row>[];
  getContext: (
    row?: Row,
    field?: GridResolvedField<Row>,
    value?: unknown,
  ) => Omit<GridActionContext<Row>, 'signal'>;
  run: (
    action: GridAction<Row> | string,
    input?: { row?: Row; field?: GridResolvedField<Row>; value?: unknown },
  ) => Promise<void>;
  key: (actionId: string, row?: Row) => string;
}

export interface GridOptionsLoadOptions {
  /** Cancels only this caller; a shared provider request is aborted after every caller cancels. */
  signal?: AbortSignal;
}

export interface GridOptionsApi {
  load: (
    fieldId: string,
    search?: string,
    options?: GridOptionsLoadOptions,
  ) => Promise<GridOption[]>;
  clear: (fieldId?: string) => void;
}

export interface GridInstance<Row extends object> {
  readonly definition: GridResolvedDefinition<Row>;
  readonly capabilities: GridResolvedCapabilities;
  readonly query: GridQueryApi;
  readonly columns: GridColumnsApi;
  readonly selection: GridSelectionApi<Row>;
  readonly data: GridDataApi<Row>;
  readonly views: GridViewsApi;
  readonly editing: GridEditingApi<Row>;
  readonly actions: GridActionsApi<Row>;
  readonly options: GridOptionsApi;
  getState: () => GridState<Row>;
  subscribe: (listener: () => void) => () => void;
  subscribeEvent: (listener: (event: GridEvent) => void) => () => void;
  updateOptions: (options: GridOptions<Row>) => void;
  start: () => Promise<void>;
  stop: () => void;
  destroy: () => void;
  batch: (callback: () => void) => void;
}
