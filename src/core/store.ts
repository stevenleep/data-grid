import { definitionSignature, resolveGridDefinition } from './definition';
import {
  cloneColumnState,
  cloneJson,
  createFilterGroup,
  createGridEvent,
  createGridId,
  getRequestScopeSignature,
  getRequestSignature,
  normalizeError,
  queryWithoutPagination,
  shallowArrayEqual,
  stableStringify,
  uniqueStrings,
} from './model';
import { parseGridPersistedState } from './persistence';
import {
  applyLocalGridQuery,
  compileGridQuery,
  isGridJsonValue,
  validateGridQuery,
  validateGridTemporalContext,
} from './query';
import {
  normalizeGridOptions,
  normalizeGridResult,
  resolveGridCapabilities,
  sourceDataIdentity,
} from './source';
import type {
  GridAction,
  GridActionContext,
  GridActionPlacement,
  GridActionsApi,
  GridColumnState,
  GridDataSource,
  GridDataState,
  GridDensity,
  GridEvent,
  GridEventReason,
  GridFilterCondition,
  GridFilterGroup,
  GridInstance,
  GridOption,
  GridOptions,
  GridPagination,
  GridPersistedState,
  GridPersistence,
  GridQuery,
  GridReadResult,
  GridRemoteSource,
  GridRequestQuery,
  GridRequestReason,
  GridResolvedCapabilities,
  GridResolvedColumn,
  GridResolvedDefinition,
  GridResolvedField,
  GridRowKey,
  GridSelectionState,
  GridSort,
  GridState,
  GridView,
} from './types';

interface RequestCacheEntry<Row extends object> {
  result: GridReadResult<Row>;
  createdAt: number;
  accessedAt: number;
}

interface OptionCacheEntry {
  fieldId: string;
  value?: GridOption[];
  promise?: Promise<GridOption[]>;
  controller?: AbortController;
  consumers?: number;
  createdAt: number;
}

const abortedOperation = Symbol('grid-aborted-operation');

function raceWithAbort<Value>(
  promise: Promise<Value>,
  signal: AbortSignal,
): Promise<Value | typeof abortedOperation> {
  if (signal.aborted) return Promise.resolve(abortedOperation);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => finish(() => resolve(abortedOperation));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

function leafColumns<Row extends object>(
  columns: readonly GridResolvedColumn<Row>[],
): GridResolvedColumn<Row>[] {
  return columns.flatMap((column) =>
    column.children?.length ? leafColumns(column.children) : [column],
  );
}

function defaultColumnState<Row extends object>(
  columns: readonly GridResolvedColumn<Row>[],
  density: GridDensity,
): GridColumnState {
  const leaves = leafColumns(columns);
  return {
    order: leaves.map((column) => column.id),
    hidden: leaves.filter((column) => column.hidden).map((column) => column.id),
    widths: Object.fromEntries(leaves.map((column) => [column.id, column.width || 160])),
    pinned: Object.fromEntries(
      leaves.filter((column) => column.fixed).map((column) => [column.id, column.fixed || null]),
    ),
    density,
  };
}

function emptyData<Row extends object>(): GridDataState<Row> {
  return {
    status: 'idle',
    fetching: false,
    rows: [],
    summary: [],
    facets: {},
    warnings: [],
  };
}

function defaultQuery(pagination: 'offset' | 'cursor', pageSize: number): GridQuery {
  const page: GridPagination =
    pagination === 'cursor' ? { type: 'cursor', pageSize } : { type: 'offset', page: 1, pageSize };
  return {
    pagination: page,
    keyword: '',
    filters: createFilterGroup(),
    sorts: [],
  };
}

function mergeInitialQuery(
  base: GridQuery,
  initial: GridOptions<object>['defaultState'],
): GridQuery {
  if (!initial?.query) return base;
  return {
    ...base,
    ...initial.query,
    pagination: initial.query.pagination || base.pagination,
    filters: initial.query.filters || base.filters,
    sorts: initial.query.sorts || base.sorts,
    keyword: initial.query.keyword || '',
  };
}

function mergeInitialColumns(
  base: GridColumnState,
  initial: Partial<GridColumnState> | undefined,
): GridColumnState {
  if (!initial) return base;
  return {
    ...base,
    ...initial,
    order: initial.order || base.order,
    hidden: initial.hidden || base.hidden,
    widths: { ...base.widths, ...initial.widths },
    pinned: { ...base.pinned, ...initial.pinned },
  };
}

function sameState<Row extends object>(left: GridState<Row>, right: GridState<Row>): boolean {
  return (
    left === right ||
    (left.query === right.query &&
      left.columns === right.columns &&
      left.selection === right.selection &&
      left.data === right.data &&
      left.views === right.views &&
      left.editing === right.editing &&
      left.actions === right.actions)
  );
}

function mergeControlledState<Row extends object>(
  internal: GridState<Row>,
  controlled: Partial<GridState<Row>> | undefined,
): GridState<Row> {
  return controlled ? { ...internal, ...controlled } : internal;
}

function normalizePageSize(value: number): number {
  return Math.max(1, Math.trunc(value || 1));
}

function isEditResult<Row extends object>(
  value: unknown,
): value is {
  type: 'grid-edit-result';
  row?: Row;
  reload?: boolean;
} {
  return Boolean(
    value && typeof value === 'object' && (value as { type?: string }).type === 'grid-edit-result',
  );
}

export class GridStore<Row extends object> implements GridInstance<Row> {
  private definitionValue: GridResolvedDefinition<Row>;
  capabilities: GridResolvedCapabilities;
  private optionsValue: GridOptions<Row>;
  private state: GridState<Row>;
  private internalState: GridState<Row>;
  private defaultQuery: GridQuery;
  private readonly defaultColumns: GridColumnState;
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(event: GridEvent) => void>();
  private selectedRows = new Map<GridRowKey, Row>();
  private requestCache = new Map<string, RequestCacheEntry<Row>>();
  private optionCache = new Map<string, OptionCacheEntry>();
  private actionControllers = new Map<string, AbortController>();
  private editController?: AbortController;
  private editRollback?: { key: GridRowKey; row: Row; optimisticRow: Row };
  private requestController?: AbortController;
  private requestPromise?: Promise<void>;
  private activeRequestSignature?: string;
  private requestId = 0;
  private started = false;
  private destroyed = false;
  private lifecycleId = 0;
  private persistenceTimer?: ReturnType<typeof setTimeout>;
  private persistenceRestored = false;
  private persistencePromise?: Promise<boolean>;
  private batchDepth = 0;
  private pendingChanged = false;
  private pendingEvent?: GridEvent;
  private pendingState?: GridState<Row>;
  private pendingPersist = false;
  private pendingLoad?: { force: boolean; reason: GridRequestReason };
  private sourceIdentity: unknown[];
  private sourceGeneration = 0;
  private persistenceGeneration = 0;
  private persistenceIdentity: unknown;
  private persistenceSaveChains = new Map<unknown, Promise<void>>();

  constructor(options: GridOptions<Row>) {
    validateGridTemporalContext(options.temporal);
    validateStateContainer(options.defaultState, 'Grid defaultState');
    validateStateContainer(options.state, 'Grid state');
    this.optionsValue = options;
    this.definitionValue = resolveGridDefinition(options.definition);
    this.capabilities = resolveGridCapabilities(options.source);
    this.sourceIdentity = sourceDataIdentity(options.source);
    this.persistenceIdentity = this.getPersistenceIdentity(options.persistence);
    const pageSize = normalizePageSize(this.definition.defaults?.pageSize || 20);
    this.defaultQuery = defaultQuery(this.capabilities.pagination, pageSize);
    this.defaultColumns = defaultColumnState(
      this.definition.columns,
      this.definition.defaults?.density || 'compact',
    );
    const query = mergeInitialQuery(
      this.defaultQuery,
      options.defaultState as GridOptions<object>['defaultState'],
    );
    const columns = mergeInitialColumns(this.defaultColumns, options.defaultState?.columns);
    validateGridQuery(query, this.definition, this.capabilities);
    const internalState: GridState<Row> = {
      query,
      columns,
      selection: options.defaultState?.selection || {
        mode: 'explicit',
        selectedKeys: [],
      },
      data: { ...emptyData<Row>(), ...options.defaultState?.data },
      views: {
        activeId: options.defaultState?.views?.activeId,
        items: options.defaultState?.views?.items || [],
        dirty: options.defaultState?.views?.dirty || false,
      },
      editing: { saving: false },
      actions: { pending: {}, errors: {} },
    };
    const state = mergeControlledState(internalState, options.state);
    this.validateStateProtocol(state, 'Grid initial state', this.definition, this.capabilities);
    this.internalState = internalState;
    this.state = state;
    if (this.capabilities.projection) this.compileRequest(this.state.query, this.state.columns);
  }

  get definition(): GridResolvedDefinition<Row> {
    return this.definitionValue;
  }

  getState = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  subscribeEvent = (listener: (event: GridEvent) => void) => {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  };

  updateOptions = (options: GridOptions<Row>) => {
    if (this.destroyed) return;
    validateGridTemporalContext(options.temporal);
    validateStateContainer(options.state, 'Grid state');
    const resolved = resolveGridDefinition(options.definition);
    if (resolved.id !== this.definition.id || resolved.revision !== this.definition.revision) {
      throw new Error('Changing a grid definition requires a new GridInstance.');
    }
    if (definitionSignature(resolved) !== definitionSignature(this.definition)) {
      throw new Error(
        'Changing grid fields, columns or protocol structure requires a new definition revision.',
      );
    }

    const previousOptions = this.optionsValue;
    const previousState = this.state;
    const previousSourceMode = previousOptions.source.mode;
    const sourceModeChanged = previousSourceMode !== options.source.mode;
    const previousSourceIdentity = this.sourceIdentity;
    const previousDatasetIdentity = this.getSourceDatasetIdentity(previousOptions.source);
    const nextCapabilities = resolveGridCapabilities(options.source);
    const nextSourceIdentity = sourceDataIdentity(options.source);
    const nextDatasetIdentity = this.getSourceDatasetIdentity(options.source);
    const nextPersistenceIdentity = this.getPersistenceIdentity(options.persistence);
    const persistenceChanged = !Object.is(this.persistenceIdentity, nextPersistenceIdentity);
    const sourceChanged = !shallowArrayEqual(previousSourceIdentity, nextSourceIdentity);
    const datasetChanged = !shallowArrayEqual(previousDatasetIdentity, nextDatasetIdentity);
    const optionFieldsChanged = resolved.fields
      .filter((field) => this.definition.fieldMap.get(field.id)?.options !== field.options)
      .map((field) => field.id);

    let nextInternal = options.state
      ? { ...this.internalState, ...options.state }
      : this.internalState;
    let next = mergeControlledState(nextInternal, options.state);
    let normalizedControlledState = options.state;
    if (
      !isPlainRecord(next.query) ||
      !isPlainRecord(next.query.pagination) ||
      typeof next.query.keyword !== 'string'
    ) {
      throw new Error('Grid state query and pagination must match the grid query protocol.');
    }
    if (next.query.pagination.type !== nextCapabilities.pagination) {
      const pageSize = next.query.pagination.pageSize;
      const pagination: GridPagination =
        nextCapabilities.pagination === 'cursor'
          ? { type: 'cursor', pageSize }
          : { type: 'offset', page: 1, pageSize };
      next = { ...next, query: { ...next.query, pagination } };
      nextInternal = { ...nextInternal, query: next.query };
      if (normalizedControlledState?.query) {
        normalizedControlledState = { ...normalizedControlledState, query: next.query };
      }
    } else if (datasetChanged && !this.isSliceControlled(options.state, 'query')) {
      const query = { ...next.query, pagination: this.resetPagination(next.query.pagination) };
      next = { ...next, query };
      nextInternal = { ...nextInternal, query };
    }
    const reconciledQuery = this.reconcileQueryForCapabilities(
      next.query,
      resolved,
      nextCapabilities,
    );
    if (reconciledQuery !== next.query) {
      next = { ...next, query: reconciledQuery };
      nextInternal = { ...nextInternal, query: reconciledQuery };
      if (this.isSliceControlled(normalizedControlledState, 'query')) {
        normalizedControlledState = { ...normalizedControlledState, query: reconciledQuery };
      }
    }
    validateGridQuery(next.query, resolved, nextCapabilities);
    this.validateStateProtocol(next, 'Grid state', resolved, nextCapabilities);
    if (nextCapabilities.projection) {
      const projectedQuery = {
        ...next.query,
        projection: this.visibleFieldIds(next.columns, next.query.projection, resolved),
      };
      compileGridQuery(projectedQuery, resolved);
    }

    if (persistenceChanged) {
      this.flushPendingPersistence(previousOptions.persistence, previousState, this.definition);
    }

    this.optionsValue =
      normalizedControlledState === options.state
        ? options
        : { ...options, state: normalizedControlledState };
    this.definitionValue = resolved;
    this.capabilities = nextCapabilities;
    this.sourceIdentity = nextSourceIdentity;
    this.persistenceIdentity = nextPersistenceIdentity;
    this.internalState = nextInternal;
    this.state = next;
    if (previousState.query.pagination.type !== nextCapabilities.pagination) {
      this.defaultQuery = defaultQuery(
        nextCapabilities.pagination,
        normalizePageSize(this.definition.defaults?.pageSize || 20),
      );
    }
    if (persistenceChanged) {
      this.persistenceGeneration += 1;
      this.persistenceRestored = false;
      this.persistencePromise = undefined;
    }
    if (datasetChanged) this.invalidateSourceWork();
    else if (sourceChanged || sourceModeChanged) {
      this.invalidateReadRequest();
    }
    if (!datasetChanged) optionFieldsChanged.forEach((fieldId) => this.clearOptionCache(fieldId));
    next = this.state;
    if (!sameState(previousState, next)) this.listeners.forEach((listener) => listener());

    const queryChanged = previousState.query !== next.query;
    const columnsChanged = previousState.columns !== next.columns;
    if (
      queryChanged &&
      previousState.selection === next.selection &&
      !this.isControlled('selection')
    ) {
      const beforeScope = this.requestScope(previousState.query, previousState.columns);
      const afterScope = this.requestScope(next.query, next.columns);
      if (beforeScope !== afterScope) this.clearSelection('system');
    }
    if (sourceChanged || sourceModeChanged) {
      this.requestCache.clear();
    }
    if (persistenceChanged && this.started && options.persistence) {
      void this.restorePersistenceOnce().then((requestChanged) => {
        if (requestChanged && this.started && !this.destroyed) this.queueLoad(false, 'query');
      });
    }
    if (!this.started) return;
    if (options.source.mode === 'controlled') {
      if (sourceChanged || sourceModeChanged) {
        this.syncControlledSource();
      }
      if (sourceModeChanged) {
        this.notifyControlledQuery(createGridEvent('query.external', 'source'));
      }
    } else if (sourceChanged || sourceModeChanged) {
      this.queueLoad(true, 'source');
    } else if (queryChanged) {
      this.queueLoad(false, 'query');
    } else if (columnsChanged && this.capabilities.projection) {
      this.queueLoad(false, 'projection');
    }
  };

  start = async () => {
    if (this.started) return;
    if (this.destroyed) throw new Error('A destroyed GridInstance cannot be restarted.');
    const lifecycleId = ++this.lifecycleId;
    this.started = true;
    await this.restorePersistenceOnce();
    if (this.destroyed || lifecycleId !== this.lifecycleId) return;
    await this.load(false, 'initial');
  };

  stop = () => {
    const wasStarted = this.started;
    this.started = false;
    if (wasStarted) this.lifecycleId += 1;
    if (this.persistencePromise) {
      this.persistenceGeneration += 1;
      this.persistenceRestored = false;
      this.persistencePromise = undefined;
    }
    this.sourceGeneration += 1;
    this.invalidateReadRequest();
    this.editController?.abort();
    this.editController = undefined;
    this.rollbackOptimisticEdit();
    this.actionControllers.forEach((controller) => controller.abort());
    this.actionControllers.clear();
    [...this.optionCache.entries()].forEach(([key, entry]) => {
      if (!entry.promise) return;
      entry.controller?.abort();
      this.optionCache.delete(key);
    });
    const pendingActions = Object.fromEntries(
      Object.keys(this.state.actions.pending).map((key) => [key, false]),
    );
    if (this.state.editing.saving || Object.values(this.state.actions.pending).some(Boolean)) {
      this.commit(
        {
          ...this.internalState,
          editing: { saving: false },
          actions: { ...this.state.actions, pending: pendingActions },
        },
        createGridEvent('lifecycle.stop', 'system'),
      );
    }
    if (this.persistenceTimer) {
      clearTimeout(this.persistenceTimer);
      this.persistenceTimer = undefined;
      void this.persist();
    }
  };

  destroy = () => {
    if (this.destroyed) return;
    this.stop();
    this.destroyed = true;
    this.listeners.clear();
    this.eventListeners.clear();
  };

  batch = (callback: () => void) => {
    if (this.destroyed) return;
    this.batchDepth += 1;
    try {
      callback();
    } finally {
      this.batchDepth -= 1;
      if (this.batchDepth === 0) this.flushBatch();
    }
  };

  query = {
    set: (query: GridQuery, reason: GridEventReason = 'api') => {
      this.setQuery(query, createGridEvent('query.set', reason));
    },
    update: (updater: (query: GridQuery) => GridQuery, reason: GridEventReason = 'api') => {
      this.setQuery(updater(this.state.query), createGridEvent('query.update', reason));
    },
    setKeyword: (keyword: string, reason: GridEventReason = 'api') => {
      const pagination = this.resetPagination(this.state.query.pagination);
      this.setQuery(
        { ...this.state.query, keyword, pagination },
        createGridEvent('query.keyword', reason),
      );
    },
    setFilters: (filters: GridFilterGroup, reason: GridEventReason = 'api') => {
      const pagination = this.resetPagination(this.state.query.pagination);
      this.setQuery(
        { ...this.state.query, filters, pagination },
        createGridEvent('query.filters', reason),
      );
    },
    setSorts: (sorts: GridSort[], reason: GridEventReason = 'api') => {
      const pagination = this.resetPagination(this.state.query.pagination);
      this.setQuery(
        { ...this.state.query, sorts, pagination },
        createGridEvent('query.sorts', reason),
      );
    },
    setPage: (page: number, reason: GridEventReason = 'api') => {
      if (this.state.query.pagination.type !== 'offset') return;
      this.setQuery(
        {
          ...this.state.query,
          pagination: { ...this.state.query.pagination, page: Math.max(1, Math.trunc(page)) },
        },
        createGridEvent('query.page', reason),
        'pagination',
      );
    },
    setPageSize: (pageSize: number, reason: GridEventReason = 'api') => {
      const size = normalizePageSize(pageSize);
      const pagination: GridPagination =
        this.state.query.pagination.type === 'offset'
          ? { type: 'offset', page: 1, pageSize: size }
          : { type: 'cursor', pageSize: size };
      this.setQuery(
        { ...this.state.query, pagination },
        createGridEvent('query.pageSize', reason),
        'pagination',
      );
    },
    goToCursor: (
      cursor: string | undefined,
      direction: 'forward' | 'backward',
      reason: GridEventReason = 'api',
    ) => {
      if (this.state.query.pagination.type !== 'cursor') return;
      this.setQuery(
        {
          ...this.state.query,
          pagination: { ...this.state.query.pagination, cursor, direction },
        },
        createGridEvent('query.cursor', reason),
        'pagination',
      );
    },
    reset: (reason: GridEventReason = 'api') => {
      this.setQuery(cloneJson(this.defaultQuery), createGridEvent('query.reset', reason));
    },
    compile: () => this.compileRequest(),
  };

  columns = {
    getDefaultState: () => cloneColumnState(this.defaultColumns),
    setVisible: (columnId: string, visible: boolean) => {
      if (typeof columnId !== 'string' || typeof visible !== 'boolean') {
        throw new Error('Column visibility requires a column id and boolean visible value.');
      }
      const column = this.definition.columnMap.get(columnId);
      if (!column || column.children?.length || column.hideable === false) return;
      const hidden = new Set(this.state.columns.hidden);
      if (visible) hidden.delete(columnId);
      else hidden.add(columnId);
      this.setColumns(
        { ...this.state.columns, hidden: [...hidden] },
        createGridEvent('columns.visibility', 'user', { columnId, visible }),
      );
    },
    setOrder: (columnIds: string[]) => {
      if (!Array.isArray(columnIds) || columnIds.some((id) => typeof id !== 'string')) {
        throw new Error('Column order must be an array of column ids.');
      }
      const leaves = leafColumns(this.definition.columns);
      const known = new Set(leaves.map((column) => column.id));
      const order = uniqueStrings(columnIds.filter((id) => known.has(id)));
      leaves.forEach((column) => {
        if (!order.includes(column.id)) order.push(column.id);
      });
      leaves.forEach((column) => {
        if (column.reorderable === false) {
          const previousIndex = this.state.columns.order.indexOf(column.id);
          if (order.indexOf(column.id) !== previousIndex) {
            throw new Error(`Column "${column.id}" cannot be reordered.`);
          }
        }
      });
      this.setColumns({ ...this.state.columns, order }, createGridEvent('columns.order', 'user'));
    },
    setWidth: (columnId: string, width: number) => {
      if (typeof columnId !== 'string' || typeof width !== 'number' || !Number.isFinite(width)) {
        throw new Error('Column width must be a finite number.');
      }
      const column = this.definition.columnMap.get(columnId);
      if (!column || column.children?.length || column.resizable === false) return;
      const minimum = column.minWidth || 72;
      const maximum = column.maxWidth || Number.MAX_SAFE_INTEGER;
      const resolved = Math.min(maximum, Math.max(minimum, Math.round(width)));
      this.setColumns(
        {
          ...this.state.columns,
          widths: { ...this.state.columns.widths, [columnId]: resolved },
        },
        createGridEvent('columns.width', 'user', { columnId, width: resolved }),
      );
    },
    setPinned: (columnId: string, pinned: 'left' | 'right' | null) => {
      if (
        typeof columnId !== 'string' ||
        (pinned !== null && pinned !== 'left' && pinned !== 'right')
      ) {
        throw new Error('Pinned column state must be left, right or null.');
      }
      const column = this.definition.columnMap.get(columnId);
      if (!column || column.children?.length || column.pinnable === false) return;
      this.setColumns(
        {
          ...this.state.columns,
          pinned: { ...this.state.columns.pinned, [columnId]: pinned },
        },
        createGridEvent('columns.pinned', 'user', { columnId, pinned }),
      );
    },
    setDensity: (density: GridDensity) => {
      if (!['compact', 'default', 'comfortable'].includes(density)) {
        throw new Error('Grid density is invalid.');
      }
      this.setColumns(
        { ...this.state.columns, density },
        createGridEvent('columns.density', 'user', { density }),
      );
    },
    reset: () => {
      this.setColumns(
        cloneColumnState(this.defaultColumns),
        createGridEvent('columns.reset', 'user'),
      );
    },
  };

  selection = {
    set: (keys: readonly GridRowKey[], rows: readonly Row[] = []) => {
      if (!Array.isArray(keys) || !Array.isArray(rows)) {
        throw new Error('Grid selection keys and rows must be arrays.');
      }
      const validKeys = keys.filter(isValidGridRowKey);
      const rowEntries = rows.map((row) => [this.definition.getRowKey(row), row] as const);
      if (this.state.selection.mode !== 'allMatching') {
        rowEntries.forEach(([key, row]) => this.selectedRows.set(key, row));
      }
      if (this.state.selection.mode === 'allMatching') {
        const selected = new Set(validKeys);
        const currentKeys = this.state.data.rows.map(this.definition.getRowKey);
        const excluded = new Set(this.state.selection.excludedKeys);
        currentKeys.forEach((key) => {
          if (selected.has(key)) excluded.delete(key);
          else excluded.add(key);
        });
        this.setSelection({ ...this.state.selection, excludedKeys: [...excluded] });
        return;
      }
      const keySet = new Set(validKeys);
      [...this.selectedRows.keys()].forEach((key) => {
        if (!keySet.has(key)) this.selectedRows.delete(key);
      });
      this.setSelection({ mode: 'explicit', selectedKeys: [...keySet] });
    },
    toggle: (key: GridRowKey, row: Row, selected?: boolean) => {
      if (!isValidGridRowKey(key)) throw new Error('Grid selection requires a valid row key.');
      const rowKey = this.definition.getRowKey(row);
      if (rowKey !== key) {
        throw new Error(
          `Selected row key ${typeof rowKey}:${String(rowKey)} does not match selection key ${typeof key}:${String(key)}.`,
        );
      }
      const current = this.selection.isSelected(key);
      const nextSelected = selected ?? !current;
      if (this.state.selection.mode === 'allMatching') {
        const excluded = new Set(this.state.selection.excludedKeys);
        if (nextSelected) excluded.delete(key);
        else excluded.add(key);
        this.setSelection({ ...this.state.selection, excludedKeys: [...excluded] });
        return;
      }
      this.selectedRows.set(key, row);
      const keys = new Set(this.state.selection.selectedKeys);
      if (nextSelected) keys.add(key);
      else {
        keys.delete(key);
        this.selectedRows.delete(key);
      }
      this.setSelection({ mode: 'explicit', selectedKeys: [...keys] });
    },
    selectPage: (rows: readonly Row[] = this.state.data.rows) => {
      if (!Array.isArray(rows)) throw new Error('Selected page rows must be an array.');
      const entries = rows.map((row) => [this.definition.getRowKey(row), row] as const);
      const keys = entries.map(([key]) => key);
      if (this.state.selection.mode !== 'allMatching') {
        entries.forEach(([key, row]) => this.selectedRows.set(key, row));
      }
      if (this.state.selection.mode === 'allMatching') {
        const excluded = new Set(this.state.selection.excludedKeys);
        keys.forEach((key) => excluded.delete(key));
        this.setSelection({ ...this.state.selection, excludedKeys: [...excluded] });
      } else {
        this.setSelection({
          mode: 'explicit',
          selectedKeys: uniqueRowKeys([...this.state.selection.selectedKeys, ...keys]),
        });
      }
    },
    selectAllMatching: () => {
      const total = this.state.data.total;
      if (
        !this.capabilities.selectAllMatching ||
        !total ||
        (total.accuracy && total.accuracy !== 'exact')
      ) {
        return;
      }
      this.selectedRows.clear();
      this.setSelection({
        mode: 'allMatching',
        querySignature: this.requestScope(),
        excludedKeys: [],
        total: total.value,
      });
    },
    clear: () => this.clearSelection('user'),
    isSelected: (key: GridRowKey) => {
      const selection = this.state.selection;
      return selection.mode === 'explicit'
        ? selection.selectedKeys.includes(key)
        : selection.querySignature === this.requestScope() && !selection.excludedKeys.includes(key);
    },
    getCount: () => {
      const selection = this.state.selection;
      return selection.mode === 'explicit'
        ? selection.selectedKeys.length
        : selection.querySignature === this.requestScope()
          ? Math.max(0, selection.total - selection.excludedKeys.length)
          : 0;
    },
    getSelectedRows: () => {
      if (this.state.selection.mode === 'allMatching') return [];
      const currentRows = new Map(
        this.state.data.rows.map((row) => [this.definition.getRowKey(row), row]),
      );
      return this.state.selection.selectedKeys
        .map((key) => currentRows.get(key) || this.selectedRows.get(key))
        .filter((row): row is Row => Boolean(row));
    },
  };

  data = {
    reload: () => this.load(true, 'refresh'),
    invalidate: () => {
      this.requestCache.clear();
      return this.load(true, 'refresh');
    },
    updateRow: (key: GridRowKey, row: Row) => {
      const replacementKey = this.definition.getRowKey(row);
      if (replacementKey !== key) {
        throw new Error(
          `Grid row replacement key ${typeof replacementKey}:${String(replacementKey)} does not match target key ${typeof key}:${String(key)}.`,
        );
      }
      const rows = this.state.data.rows.map((current) =>
        this.definition.getRowKey(current) === key ? row : current,
      );
      if (!rows.some((current) => this.definition.getRowKey(current) === key)) return;
      if (this.selectedRows.has(key)) this.selectedRows.set(key, row);
      this.requestCache.clear();
      this.commit(
        { ...this.internalState, data: { ...this.state.data, rows } },
        createGridEvent('data.row.update', 'api', { key }),
      );
    },
    patchRow: (key: GridRowKey, patch: Partial<Row>) => {
      const current = this.state.data.rows.find((row) => this.definition.getRowKey(row) === key);
      if (current) this.data.updateRow(key, { ...current, ...patch });
    },
  };

  views = {
    create: (name: string, scope: GridView['scope'] = 'private') => {
      if (typeof name !== 'string' || !['private', 'shared', 'system'].includes(scope)) {
        throw new Error('A grid view requires a string name and valid scope.');
      }
      const trimmed = name.trim();
      if (!trimmed) return undefined;
      const now = new Date().toISOString();
      const view: GridView = {
        id: createGridId('view'),
        name: trimmed,
        scope,
        query: queryWithoutPagination(this.state.query),
        columns: cloneColumnState(this.state.columns),
        createdAt: now,
        updatedAt: now,
      };
      this.commit(
        {
          ...this.internalState,
          views: { activeId: view.id, items: [...this.state.views.items, view], dirty: false },
        },
        createGridEvent('views.create', 'user', { id: view.id }),
        true,
      );
      return view;
    },
    rename: (id: string, name: string) => {
      if (typeof id !== 'string' || typeof name !== 'string') {
        throw new Error('Renaming a grid view requires string id and name values.');
      }
      const trimmed = name.trim();
      if (!trimmed) return;
      const view = this.state.views.items.find((item) => item.id === id);
      if (!view || view.readonly) return;
      this.commit(
        {
          ...this.internalState,
          views: {
            ...this.state.views,
            items: this.state.views.items.map((item) =>
              item.id === id
                ? { ...item, name: trimmed, updatedAt: new Date().toISOString() }
                : item,
            ),
          },
        },
        createGridEvent('views.rename', 'user', { id }),
        true,
      );
    },
    duplicate: (id: string, name?: string) => {
      if (typeof id !== 'string' || (name !== undefined && typeof name !== 'string')) {
        throw new Error('Duplicating a grid view requires a string id and optional name.');
      }
      const source = this.state.views.items.find((item) => item.id === id);
      if (!source) return undefined;
      const now = new Date().toISOString();
      const view: GridView = {
        ...cloneJson(source),
        id: createGridId('view'),
        name: name?.trim() || `${source.name} Copy`,
        scope: 'private',
        readonly: false,
        createdAt: now,
        updatedAt: now,
      };
      this.commit(
        {
          ...this.internalState,
          views: { activeId: view.id, items: [...this.state.views.items, view], dirty: false },
        },
        createGridEvent('views.duplicate', 'user', { sourceId: id, id: view.id }),
        true,
      );
      return view;
    },
    save: (id: string) => {
      const view = this.state.views.items.find((item) => item.id === id);
      if (!view || view.readonly) return;
      this.commit(
        {
          ...this.internalState,
          views: {
            activeId: id,
            dirty: false,
            items: this.state.views.items.map((item) =>
              item.id === id
                ? {
                    ...item,
                    query: queryWithoutPagination(this.state.query),
                    columns: cloneColumnState(this.state.columns),
                    updatedAt: new Date().toISOString(),
                  }
                : item,
            ),
          },
        },
        createGridEvent('views.save', 'user', { id }),
        true,
      );
    },
    apply: (id?: string) => {
      const view = id ? this.state.views.items.find((item) => item.id === id) : undefined;
      if (id && !view) return;
      const pagination = this.resetPagination(this.state.query.pagination);
      const query: GridQuery = view
        ? { ...cloneJson(view.query), pagination }
        : { ...cloneJson(this.defaultQuery), pagination };
      const columns = view
        ? this.reconcileColumns(view.columns)
        : cloneColumnState(this.defaultColumns);
      validateGridQuery(query, this.definition, this.capabilities);
      const previousRequest = getRequestSignature(this.compileRequest());
      const desiredRequest = getRequestSignature(this.compileRequest(query, columns));
      this.selectedRows.clear();
      const event = createGridEvent('views.apply', 'user', { id });
      this.commit(
        {
          ...this.internalState,
          query,
          columns,
          selection: { mode: 'explicit', selectedKeys: [] },
          views: { ...this.state.views, activeId: view?.id, dirty: false },
        },
        event,
        true,
      );
      if (this.optionsValue.source.mode === 'controlled') {
        if (previousRequest !== desiredRequest) this.notifyControlledQuery(event, query, columns);
      } else if (previousRequest !== getRequestSignature(this.compileRequest())) {
        this.queueLoad(false, 'query');
      }
    },
    remove: (id: string) => {
      const view = this.state.views.items.find((item) => item.id === id);
      if (!view || view.readonly) return;
      const active = this.state.views.activeId === id;
      this.commit(
        {
          ...this.internalState,
          views: {
            activeId: active ? undefined : this.state.views.activeId,
            items: this.state.views.items.filter((item) => item.id !== id),
            dirty: active ? false : this.state.views.dirty,
          },
        },
        createGridEvent('views.remove', 'user', { id }),
        true,
      );
      if (active) this.views.apply();
    },
    reset: () => this.views.apply(),
  };

  editing = {
    canEdit: (row: Row, fieldId: string) => {
      const field = this.definition.fieldMap.get(fieldId);
      return Boolean(
        field?.edit &&
        this.definition.editing &&
        (this.definition.editing.canEdit?.(row, field) ?? true),
      );
    },
    begin: (row: Row, fieldId: string) => {
      if (this.destroyed) return;
      const field = this.definition.fieldMap.get(fieldId);
      if (!field || !this.editing.canEdit(row, fieldId)) return;
      const value = field.getValue(row);
      this.editController?.abort();
      this.editController = undefined;
      this.rollbackOptimisticEdit();
      this.commit(
        {
          ...this.internalState,
          editing: {
            active: {
              rowKey: this.definition.getRowKey(row),
              fieldId,
              previousValue: value,
              draft: value,
            },
            saving: false,
          },
        },
        createGridEvent('editing.begin', 'user', { fieldId }),
      );
    },
    setDraft: (value: unknown) => {
      if (!this.state.editing.active) return;
      this.commit(
        {
          ...this.internalState,
          editing: {
            ...this.state.editing,
            active: { ...this.state.editing.active, draft: value },
            error: undefined,
            errorCode: undefined,
          },
        },
        createGridEvent('editing.draft', 'user'),
      );
    },
    commit: async () => {
      if (this.destroyed) return false;
      const active = this.state.editing.active;
      const editing = this.definition.editing;
      if (!active || !editing || this.state.editing.saving) return false;
      const field = this.definition.fieldMap.get(active.fieldId);
      const row = this.state.data.rows.find(
        (item) => this.definition.getRowKey(item) === active.rowKey,
      );
      if (!field || !row) return false;
      this.editController?.abort();
      const controller = new AbortController();
      this.editController = controller;
      this.commit(
        {
          ...this.internalState,
          editing: {
            ...this.state.editing,
            saving: true,
            error: undefined,
            errorCode: undefined,
          },
        },
        createGridEvent('editing.save.start', 'user'),
      );
      let optimisticRow: Row | undefined;
      try {
        const value = field.normalize(active.draft, row);
        if (field.edit && field.edit.required && field.isEmpty(value)) {
          if (this.editController === controller) this.editController = undefined;
          this.setEditingError('This field is required.', 'required');
          return false;
        }
        const validation = field.validate
          ? await raceWithAbort(Promise.resolve(field.validate(value, row)), controller.signal)
          : undefined;
        if (validation === abortedOperation) return false;
        if (typeof validation === 'string' && validation) {
          if (this.editController === controller) this.editController = undefined;
          this.setEditingError(validation, 'validation');
          return false;
        }
        const rollbackRow = { ...row };
        optimisticRow =
          editing.optimistic && editing.apply ? editing.apply(row, field, value) : undefined;
        if (optimisticRow === row) {
          this.editRollback = { key: active.rowKey, row: rollbackRow, optimisticRow };
          this.rollbackOptimisticEdit();
          throw new Error('Optimistic editing apply must return a new row object.');
        }
        if (optimisticRow) {
          this.editRollback = { key: active.rowKey, row, optimisticRow };
          this.data.updateRow(active.rowKey, optimisticRow);
        }
        const encodedValue = field.encodeValue(value);
        if (encodedValue !== undefined && !isGridJsonValue(encodedValue)) {
          throw new Error(`Encoded value for field "${field.id}" is not JSON-safe.`);
        }
        const result = await raceWithAbort(
          editing.save({
            row,
            rowKey: active.rowKey,
            field,
            previousValue: active.previousValue,
            value,
            encodedValue,
            signal: controller.signal,
            instance: this,
          }),
          controller.signal,
        );
        if (result === abortedOperation) return false;
        let reload = editing.reloadOnSave ?? true;
        if (isEditResult<Row>(result)) {
          if (result.row) this.data.updateRow(active.rowKey, result.row);
          reload = result.reload ?? !result.row;
        } else if (result && typeof result === 'object') {
          this.data.updateRow(active.rowKey, result as Row);
          reload = false;
        }
        this.editRollback = undefined;
        this.editController = undefined;
        this.commit(
          { ...this.internalState, editing: { saving: false } },
          createGridEvent('editing.save.success', 'source'),
        );
        if (reload) await this.data.reload();
        return true;
      } catch (error) {
        if (controller.signal.aborted) return false;
        if (optimisticRow) this.rollbackOptimisticEdit();
        this.editController = undefined;
        const normalized = normalizeError(error, 'Unable to save the value.');
        this.setEditingError(normalized.message, 'saveFailed');
        this.reportError(normalized, createGridEvent('editing.save.error', 'source'));
        return false;
      }
    },
    cancel: () => {
      this.cancelEditing('user');
    },
  };

  actions: GridActionsApi<Row> = {
    list: (placement: GridActionPlacement, row?: Row) => {
      const context = this.actions.getContext(row);
      return (this.definition.actions || [])
        .filter((action) => (action.placement || 'toolbar') === placement)
        .filter((action) =>
          typeof action.visible === 'function' ? action.visible(context) : action.visible !== false,
        )
        .sort((left, right) => (left.order || 0) - (right.order || 0));
    },
    getContext: (row?: Row, field?: GridResolvedField<Row>, value?: unknown) => ({
      instance: this,
      query: this.state.query,
      request: this.compileRequest(),
      selection: this.state.selection,
      selectedRows: this.selection.getSelectedRows(),
      row,
      field,
      value,
    }),
    run: async (
      actionOrId: GridAction<Row> | string,
      input: { row?: Row; field?: GridResolvedField<Row>; value?: unknown } = {},
    ) => {
      if (this.destroyed) throw new Error('A destroyed GridInstance cannot run actions.');
      const action =
        typeof actionOrId === 'string'
          ? this.definition.actions?.find((item) => item.id === actionOrId)
          : actionOrId;
      if (!action) throw new Error(`Unknown grid action: ${String(actionOrId)}`);
      const key = this.actions.key(action.id, input.row);
      if (this.state.actions.pending[key]) return;
      const baseContext = this.actions.getContext(input.row, input.field, input.value);
      const visible =
        typeof action.visible === 'function'
          ? action.visible(baseContext)
          : action.visible !== false;
      const disabled =
        typeof action.disabled === 'function' ? action.disabled(baseContext) : action.disabled;
      if (!visible || disabled) return;

      const controller = new AbortController();
      this.actionControllers.set(key, controller);
      this.commit(
        {
          ...this.internalState,
          actions: {
            pending: { ...this.state.actions.pending, [key]: true },
            errors: { ...this.state.actions.errors, [key]: undefined },
          },
        },
        createGridEvent('actions.run.start', 'user', { actionId: action.id, key }),
      );
      const context: GridActionContext<Row> = { ...baseContext, signal: controller.signal };
      try {
        const result = await raceWithAbort(Promise.resolve(action.run(context)), controller.signal);
        if (result === abortedOperation) return;
        if (!controller.signal.aborted && action.refresh) await this.data.reload();
        if (!controller.signal.aborted) {
          this.finishAction(
            key,
            createGridEvent('actions.run.success', 'source', { actionId: action.id }),
          );
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        const normalized = normalizeError(error, 'Action failed.');
        this.finishAction(
          key,
          createGridEvent('actions.run.error', 'source', { actionId: action.id }),
          normalized.message,
        );
        this.reportError(normalized, createGridEvent('actions.run.error', 'source'));
        throw normalized;
      } finally {
        if (this.actionControllers.get(key) === controller) {
          this.actionControllers.delete(key);
        }
      }
    },
    key: (actionId: string, row?: Row) => {
      if (!row) return stableStringify(['grid-action', actionId]);
      const rowKey = this.definition.getRowKey(row);
      return stableStringify(['row-action', actionId, typeof rowKey, rowKey]);
    },
  };

  options = {
    load: async (fieldId: string, search = '', options: { signal?: AbortSignal } = {}) => {
      if (this.destroyed) throw new Error('A destroyed GridInstance cannot load options.');
      const field = this.definition.fieldMap.get(fieldId);
      if (!field) throw new Error(`Unknown grid field: ${fieldId}`);
      const normalizedSearch = search.trim().toLocaleLowerCase();
      const facet = this.state.data.facets?.[fieldId];
      if (facet?.length && (!normalizedSearch || !field.options)) {
        return normalizedSearch
          ? facet.filter((option) =>
              String(option.label).toLocaleLowerCase().includes(normalizedSearch),
            )
          : facet;
      }
      if (!field.options) return [];
      if (Array.isArray(field.options)) {
        const items = normalizeGridOptions(field.options, `Options for field "${fieldId}"`);
        return normalizedSearch
          ? items.filter((option) =>
              String(option.label).toLocaleLowerCase().includes(normalizedSearch),
            )
          : items;
      }
      const provider =
        typeof field.options === 'function' ? { load: field.options } : field.options;
      const dependency = this.optionDependency(provider.dependsOn);
      const key = stableStringify([fieldId, normalizedSearch, dependency]);
      const cached = this.optionCache.get(key);
      const cacheTime = provider.cacheTime ?? 30_000;
      if (cacheTime > 0 && cached?.value && Date.now() - cached.createdAt <= cacheTime) {
        return cached.value;
      }
      if (cached?.promise) return this.consumeOptionPromise(key, cached, options.signal);

      const controller = new AbortController();
      const sourceGeneration = this.sourceGeneration;
      const entry: OptionCacheEntry = {
        fieldId,
        controller,
        consumers: 0,
        createdAt: Date.now(),
      };
      let onProviderAbort: (() => void) | undefined;
      const aborted = new Promise<GridOption[]>((resolve) => {
        onProviderAbort = () => resolve([]);
        controller.signal.addEventListener('abort', onProviderAbort, { once: true });
      });
      let resolveProvider!: (value: unknown) => void;
      let rejectProvider!: (error: unknown) => void;
      const providerResult = new Promise<unknown>((resolve, reject) => {
        resolveProvider = resolve;
        rejectProvider = reject;
      });
      const loaded = providerResult.then((items) =>
        normalizeGridOptions(items, `Options for field "${fieldId}"`),
      );
      const promise = Promise.race([loaded, aborted])
        .then((value) => {
          if (controller.signal.aborted || sourceGeneration !== this.sourceGeneration) return [];
          if (this.optionCache.get(key) === entry) {
            if (cacheTime > 0) {
              this.optionCache.set(key, { fieldId, value, createdAt: Date.now() });
            } else {
              this.optionCache.delete(key);
            }
          }
          this.trimOptionCache();
          return value;
        })
        .catch((error) => {
          if (this.optionCache.get(key) === entry) this.optionCache.delete(key);
          if (controller.signal.aborted) return [];
          throw error;
        })
        .finally(() => {
          if (onProviderAbort) controller.signal.removeEventListener('abort', onProviderAbort);
        });
      entry.promise = promise;
      this.optionCache.set(key, entry);
      try {
        Promise.resolve(
          provider.load({
            field,
            query: this.state.query,
            search,
            signal: controller.signal,
          }),
        ).then(resolveProvider, rejectProvider);
      } catch (error) {
        rejectProvider(error);
      }
      return this.consumeOptionPromise(key, entry, options.signal);
    },
    clear: (fieldId?: string) => this.clearOptionCache(fieldId),
  };

  private isControlled(slice: keyof GridState<Row>): boolean {
    return this.isSliceControlled(this.optionsValue.state, slice);
  }

  private reconcileQueryForCapabilities(
    query: GridQuery,
    definition: GridResolvedDefinition<Row>,
    capabilities: GridResolvedCapabilities,
  ): GridQuery {
    if (!isPlainRecord(query) || !isPlainRecord(query.filters) || !Array.isArray(query.sorts)) {
      throw new Error('Grid state query must contain filters and sorts in the grid query format.');
    }

    let remainingConditions = capabilities.filter.maxConditions;
    const reconcileGroup = (
      group: GridFilterGroup,
      depth: number,
      root: boolean,
    ): GridFilterGroup | undefined => {
      if (
        !isPlainRecord(group) ||
        group.type !== 'group' ||
        !Array.isArray(group.children) ||
        (group.logic !== 'and' && group.logic !== 'or')
      ) {
        throw new Error('Grid state query contains an invalid filter group.');
      }
      if (group.negated && !capabilities.filter.negation) {
        return root ? { ...group, logic: 'and', negated: undefined, children: [] } : undefined;
      }
      if (root && capabilities.filter.logic === 'and' && group.logic !== 'and') {
        return { ...group, logic: 'and', negated: undefined, children: [] };
      }

      const children: GridFilterGroup['children'] = [];
      for (const node of group.children) {
        if (!isPlainRecord(node) || (node.type !== 'condition' && node.type !== 'group')) {
          throw new Error('Grid state query contains an invalid filter node.');
        }
        if (node.type === 'condition') {
          if (depth + 1 > capabilities.filter.maxDepth || remainingConditions <= 0) continue;
          const field = definition.fieldMap.get(node.fieldId);
          if (!field?.filter) continue;
          if (field.filter.operators && !field.filter.operators.includes(node.operator)) {
            continue;
          }
          if (
            capabilities.filter.operators &&
            !capabilities.filter.operators.includes(node.operator)
          ) {
            continue;
          }
          remainingConditions -= 1;
          children.push(node);
          continue;
        }
        if (capabilities.filter.logic !== 'nested' || depth + 1 >= capabilities.filter.maxDepth) {
          continue;
        }
        const nested = reconcileGroup(node, depth + 1, false);
        if (nested?.children.length) children.push(nested);
      }
      return children.length === group.children.length &&
        children.every((node, index) => node === group.children[index])
        ? group
        : { ...group, children };
    };

    const filters = reconcileGroup(query.filters, 0, true) || {
      ...query.filters,
      logic: 'and',
      negated: undefined,
      children: [],
    };
    const sorts = query.sorts
      .filter((sort) => {
        if (
          !isPlainRecord(sort) ||
          typeof sort.fieldId !== 'string' ||
          (sort.direction !== 'asc' && sort.direction !== 'desc')
        ) {
          throw new Error('Grid state query contains an invalid sort declaration.');
        }
        return Boolean(definition.fieldMap.get(sort.fieldId)?.sort);
      })
      .slice(0, capabilities.sort.max)
      .map((sort) => {
        const field = definition.fieldMap.get(sort.fieldId);
        return sort.nulls &&
          (!capabilities.sort.nulls || (field?.sort && field.sort.nulls === false))
          ? { ...sort, nulls: undefined }
          : sort;
      });
    const keyword = capabilities.search ? query.keyword : '';
    if (
      keyword === query.keyword &&
      filters === query.filters &&
      shallowArrayEqual(sorts, query.sorts)
    ) {
      return query;
    }
    return { ...query, keyword, filters, sorts };
  }

  private validateStateProtocol(
    state: GridState<Row>,
    label: string,
    definition: GridResolvedDefinition<Row>,
    capabilities: GridResolvedCapabilities,
  ): void {
    if (!isPlainRecord(state)) throw new Error(`${label} must be an object.`);
    validateGridQuery(state.query, definition, capabilities);
    validateColumnState(state.columns, `${label}.columns`, definition);
    validateSelectionState(state.selection, `${label}.selection`);
    validateViewState(state.views, `${label}.views`, definition);
    validateDataState(state.data, `${label}.data`, definition);
    if (
      !isPlainRecord(state.editing) ||
      typeof state.editing.saving !== 'boolean' ||
      !isPlainRecord(state.actions) ||
      !isPlainRecord(state.actions.pending) ||
      !isPlainRecord(state.actions.errors)
    ) {
      throw new Error(`${label} editing/actions slices do not match the grid state protocol.`);
    }
  }

  private isSliceControlled(
    state: Partial<GridState<Row>> | undefined,
    slice: keyof GridState<Row>,
  ): boolean {
    return Boolean(state && Object.prototype.hasOwnProperty.call(state, slice));
  }

  private getSourceDatasetIdentity(source: GridDataSource<Row>): unknown[] {
    const datasetKey = source.datasetKey;
    if (datasetKey !== undefined) return ['dataset', datasetKey];
    if (source.mode === 'remote') return ['reader', source.read];
    return ['mode', source.mode];
  }

  private getPersistenceIdentity(
    persistence: GridOptions<Row>['persistence'],
  ): string | GridPersistence<Row> | null {
    if (!persistence) return null;
    return persistence.identity !== undefined ? persistence.identity : persistence;
  }

  private invalidateReadRequest(): void {
    this.requestController?.abort();
    this.requestController = undefined;
    this.requestPromise = undefined;
    this.activeRequestSignature = undefined;
    this.requestId += 1;
  }

  private clearOptionCache(fieldId?: string): void {
    [...this.optionCache.entries()].forEach(([key, entry]) => {
      if (fieldId === undefined || entry.fieldId === fieldId) {
        entry.controller?.abort();
        this.optionCache.delete(key);
      }
    });
  }

  private rollbackOptimisticState(state: GridState<Row>): GridState<Row> {
    const rollback = this.editRollback;
    this.editRollback = undefined;
    if (!rollback) return state;
    const index = state.data.rows.findIndex(
      (row) => this.definition.getRowKey(row) === rollback.key,
    );
    if (index < 0 || state.data.rows[index] !== rollback.optimisticRow) return state;
    const rows = [...state.data.rows];
    rows[index] = rollback.row;
    if (this.selectedRows.has(rollback.key)) this.selectedRows.set(rollback.key, rollback.row);
    this.requestCache.clear();
    return { ...state, data: { ...state.data, rows } };
  }

  private invalidateSourceWork(): void {
    this.sourceGeneration += 1;
    this.invalidateReadRequest();
    this.editController?.abort();
    this.editController = undefined;
    this.actionControllers.forEach((controller) => controller.abort());
    this.actionControllers.clear();
    this.clearOptionCache();
    this.selectedRows.clear();

    const rolledBack = this.rollbackOptimisticState(this.internalState);
    const pending = Object.fromEntries(
      Object.keys(rolledBack.actions.pending).map((key) => [key, false]),
    );
    this.internalState = {
      ...rolledBack,
      selection: this.isControlled('selection')
        ? rolledBack.selection
        : { mode: 'explicit', selectedKeys: [] },
      editing: { saving: false },
      actions: { ...rolledBack.actions, pending },
    };
    this.state = mergeControlledState(this.internalState, this.optionsValue.state);
  }

  private consumeOptionPromise(
    key: string,
    entry: OptionCacheEntry,
    signal?: AbortSignal,
  ): Promise<GridOption[]> {
    const promise = entry.promise;
    if (!promise) return Promise.resolve(entry.value || []);
    if (signal?.aborted) {
      if (!entry.consumers && this.optionCache.get(key) === entry) {
        this.optionCache.delete(key);
        entry.controller?.abort();
      }
      return Promise.resolve([]);
    }

    entry.consumers = (entry.consumers || 0) + 1;
    return new Promise<GridOption[]>((resolve, reject) => {
      let finished = false;
      const release = (cancelled: boolean) => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener('abort', onAbort);
        entry.consumers = Math.max(0, (entry.consumers || 1) - 1);
        if (cancelled && entry.consumers === 0 && this.optionCache.get(key) === entry) {
          this.optionCache.delete(key);
          entry.controller?.abort();
        }
      };
      const onAbort = () => {
        release(true);
        resolve([]);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      promise.then(
        (value) => {
          if (finished) return;
          release(false);
          resolve(value);
        },
        (error: unknown) => {
          if (finished) return;
          release(false);
          reject(error);
        },
      );
    });
  }

  private rollbackOptimisticEdit(): void {
    const next = this.rollbackOptimisticState(this.internalState);
    if (next !== this.internalState) {
      this.commit(next, createGridEvent('editing.rollback', 'system'));
    }
  }

  private cancelEditing(reason: GridEventReason): void {
    this.editController?.abort();
    this.editController = undefined;
    this.rollbackOptimisticEdit();
    this.commit(
      { ...this.internalState, editing: { saving: false } },
      createGridEvent('editing.cancel', reason),
    );
  }

  private resetPagination(pagination: GridPagination): GridPagination {
    return pagination.type === 'offset'
      ? { ...pagination, page: 1 }
      : { type: 'cursor', pageSize: pagination.pageSize };
  }

  private setQuery(
    query: GridQuery,
    event: GridEvent,
    requestReason: GridRequestReason = 'query',
  ): void {
    if (this.destroyed) return;
    validateGridQuery(query, this.definition, this.capabilities);
    const previousInternalQuery = this.internalState.query;
    const acceptedQueryChange = !this.isControlled('query') && query !== this.state.query;
    if (acceptedQueryChange && this.state.editing.active) this.cancelEditing('system');
    const previousRequestSignature = getRequestSignature(
      this.compileRequest(this.state.query, this.state.columns),
    );
    const nextRequestSignature = getRequestSignature(
      this.compileRequest(query, this.state.columns),
    );
    const requestChanged = previousRequestSignature !== nextRequestSignature;
    const previousScope = this.requestScope();
    const nextScope = this.requestScope(query, this.state.columns);
    let next: GridState<Row> = { ...this.internalState, query };
    if (previousScope !== nextScope && !this.isControlled('query')) {
      this.selectedRows.clear();
      next = { ...next, selection: { mode: 'explicit', selectedKeys: [] } };
    }
    next = this.withViewDirty(next);
    const previousQuery = this.state.query;
    this.commit(next, event);
    const intentChanged = query !== previousInternalQuery;
    if (intentChanged) {
      if (this.optionsValue.source.mode === 'controlled' && requestChanged) {
        this.notifyControlledQuery(event, query, next.columns);
      } else if (
        requestChanged &&
        !this.isControlled('query') &&
        this.state.query !== previousQuery
      ) {
        this.queueLoad(false, requestReason);
      }
    }
  }

  private setColumns(columns: GridColumnState, event: GridEvent): void {
    if (this.destroyed) return;
    validateColumnState(columns, 'Grid columns', this.definition);
    const previousRequest = this.compileRequest(this.state.query, this.state.columns);
    const previousIntentRequest = this.compileRequest(
      this.internalState.query,
      this.internalState.columns,
    );
    const nextIntentRequest = this.compileRequest(this.internalState.query, columns);
    const next = this.withViewDirty({ ...this.internalState, columns });
    const previousColumns = this.state.columns;
    this.commit(next, event, true);
    if (!this.capabilities.projection) return;
    const intentChanged =
      getRequestSignature(previousIntentRequest) !== getRequestSignature(nextIntentRequest);
    if (this.optionsValue.source.mode === 'controlled') {
      if (intentChanged) this.notifyControlledQuery(event, this.internalState.query, columns);
      return;
    }
    if (this.state.columns !== previousColumns) {
      const acceptedRequest = this.compileRequest(this.state.query, this.state.columns);
      if (getRequestSignature(previousRequest) !== getRequestSignature(acceptedRequest)) {
        this.queueLoad(false, 'projection');
      }
    }
  }

  private setSelection(selection: GridSelectionState): void {
    validateSelectionState(selection, 'Grid selection');
    this.commit({ ...this.internalState, selection }, createGridEvent('selection.change', 'user'));
  }

  private clearSelection(reason: GridEventReason): void {
    this.selectedRows.clear();
    this.commit(
      { ...this.internalState, selection: { mode: 'explicit', selectedKeys: [] } },
      createGridEvent('selection.clear', reason),
    );
  }

  private setEditingError(error: string, errorCode?: GridState<Row>['editing']['errorCode']): void {
    this.commit(
      {
        ...this.internalState,
        editing: { ...this.state.editing, saving: false, error, errorCode },
      },
      createGridEvent('editing.error', 'source'),
    );
  }

  private finishAction(key: string, event: GridEvent, error?: string): void {
    this.commit(
      {
        ...this.internalState,
        actions: {
          pending: { ...this.state.actions.pending, [key]: false },
          errors: { ...this.state.actions.errors, [key]: error },
        },
      },
      event,
    );
  }

  private commit(next: GridState<Row>, event: GridEvent, persist = false): void {
    if (this.destroyed || next === this.internalState) return;
    const previousEffective = this.state;
    this.internalState = next;
    const effective = mergeControlledState(next, this.optionsValue.state);
    this.state = effective;
    const changed = !sameState(previousEffective, effective);
    if (this.batchDepth > 0) {
      this.pendingChanged ||= changed;
      this.pendingEvent = event;
      this.pendingState = next;
      this.pendingPersist ||= persist;
      return;
    }
    if (changed) this.listeners.forEach((listener) => listener());
    this.eventListeners.forEach((listener) => listener(event));
    this.optionsValue.onStateChange?.(next, event);
    if (persist) this.schedulePersistence();
  }

  private flushBatch(): void {
    const event = this.pendingEvent;
    const state = this.pendingState;
    const changed = this.pendingChanged;
    const persist = this.pendingPersist;
    const load = this.pendingLoad;
    this.pendingChanged = false;
    this.pendingEvent = undefined;
    this.pendingState = undefined;
    this.pendingPersist = false;
    this.pendingLoad = undefined;
    if (this.destroyed) return;
    if (changed) this.listeners.forEach((listener) => listener());
    if (event) {
      this.eventListeners.forEach((listener) => listener(event));
      if (state) this.optionsValue.onStateChange?.(state, event);
    }
    if (persist) this.schedulePersistence();
    if (load) void this.load(load.force, load.reason);
  }

  private queueLoad(force: boolean, reason: GridRequestReason): void {
    if (!this.started || this.destroyed) return;
    if (this.batchDepth > 0) {
      this.pendingLoad = {
        force: force || Boolean(this.pendingLoad?.force),
        reason,
      };
      return;
    }
    void this.load(force, reason);
  }

  private compileRequest(query = this.state.query, columns = this.state.columns): GridRequestQuery {
    const requestQuery = this.capabilities.projection
      ? { ...query, projection: this.visibleFieldIds(columns, query.projection) }
      : { ...query, projection: undefined };
    return compileGridQuery(requestQuery, this.definition);
  }

  private visibleFieldIds(
    columns: GridColumnState,
    explicit?: string[],
    definition: GridResolvedDefinition<Row> = this.definition,
  ): string[] {
    if (explicit !== undefined) return explicit;
    const hidden = new Set(columns.hidden);
    return columns.order
      .filter((id) => !hidden.has(id))
      .map((id) => definition.columnMap.get(id)?.fieldId)
      .filter((id): id is string => Boolean(id));
  }

  private requestScope(query = this.state.query, columns = this.state.columns): string {
    return stableStringify([
      this.getSourceDatasetIdentity(this.optionsValue.source),
      getRequestScopeSignature(this.compileRequest(query, columns)),
    ]);
  }

  private viewQuerySignature(query: GridQuery, columns: GridColumnState): string {
    const { pagination: _pagination, ...request } = this.compileRequest(query, columns);
    return stableStringify(request);
  }

  private async load(force: boolean, reason: GridRequestReason): Promise<void> {
    if (!this.started || this.destroyed) return;
    const source = this.optionsValue.source;
    const query = this.state.query;
    validateGridQuery(query, this.definition, this.capabilities);

    if (source.mode === 'local') {
      try {
        const result = applyLocalGridQuery(
          source.rows,
          query,
          this.definition,
          this.optionsValue.temporal,
        );
        if (this.correctOutOfRangePage(result)) return;
        this.applyResult(result, undefined, reason);
      } catch (error) {
        this.applyRequestError(normalizeError(error), reason);
      }
      return;
    }
    if (source.mode === 'controlled') {
      this.notifyControlledQuery(createGridEvent('data.controlled.query', 'source'));
      this.syncControlledSource();
      return;
    }

    const request = this.compileRequest(query, this.state.columns);
    const signature = getRequestSignature(request);
    if (!force && this.activeRequestSignature === signature && this.requestPromise) {
      return this.requestPromise;
    }
    const cached = this.readCache(source, signature);
    const staleTime = Math.max(0, source.policy?.staleTime || 0);
    if (!force && cached && Date.now() - cached.createdAt <= staleTime) {
      this.applyResult(cached.result, undefined, reason);
      return;
    }

    this.requestController?.abort();
    const controller = new AbortController();
    this.requestController = controller;
    const requestId = ++this.requestId;
    const sourceGeneration = this.sourceGeneration;
    this.activeRequestSignature = signature;
    if (cached) {
      this.applyResult(cached.result, { fetching: true, requestId }, reason);
    } else {
      const keepPrevious = source.policy?.keepPreviousData ?? true;
      this.commit(
        {
          ...this.internalState,
          data: {
            ...(keepPrevious ? this.state.data : emptyData<Row>()),
            status:
              this.state.data.rows.length && keepPrevious ? this.state.data.status : 'loading',
            fetching: true,
            error: undefined,
            requestId,
          },
        },
        createGridEvent('data.load.start', 'source', { requestId, reason }),
      );
    }

    const promise = (async () => {
      try {
        const input = await raceWithAbort(
          Promise.resolve().then<GridReadResult<Row> | typeof abortedOperation>(() => {
            if (controller.signal.aborted) return abortedOperation;
            return source.read({
              query,
              request,
              fields: this.definition.fields,
              signal: controller.signal,
              requestId,
              reason,
            });
          }),
          controller.signal,
        );
        if (input === abortedOperation) return;
        const result = normalizeGridResult(input, query.pagination);
        if (
          controller.signal.aborted ||
          requestId !== this.requestId ||
          sourceGeneration !== this.sourceGeneration ||
          this.destroyed
        )
          return;
        this.validateRows(result.rows);
        if (this.correctOutOfRangePage(result)) return;
        this.writeCache(source, signature, result);
        this.applyResult(result, { requestId }, reason);
      } catch (error) {
        if (
          controller.signal.aborted ||
          requestId !== this.requestId ||
          sourceGeneration !== this.sourceGeneration ||
          this.destroyed
        )
          return;
        this.applyRequestError(normalizeError(error), reason, requestId);
      } finally {
        if (requestId === this.requestId) {
          this.requestPromise = undefined;
          this.activeRequestSignature = undefined;
        }
      }
    })();
    this.requestPromise = promise;
    return promise;
  }

  private applyResult(
    input: GridReadResult<Row>,
    state: { fetching?: boolean; requestId?: number } | undefined,
    reason: GridRequestReason,
  ): void {
    const result = this.normalizeFacets(normalizeGridResult(input, this.state.query.pagination));
    this.validateRows(result.rows);
    const selection = this.reconcileSelection(result);
    this.commit(
      {
        ...this.internalState,
        selection,
        data: {
          ...result,
          status: 'success',
          fetching: state?.fetching || false,
          requestId: state?.requestId,
          updatedAt: Date.now(),
          error: undefined,
        },
      },
      createGridEvent('data.load.success', 'source', { reason, requestId: state?.requestId }),
    );
  }

  private applyRequestError(error: Error, reason: GridRequestReason, requestId?: number): void {
    this.commit(
      {
        ...this.internalState,
        data: {
          ...this.state.data,
          status: 'error',
          fetching: false,
          error,
          requestId,
        },
      },
      createGridEvent('data.load.error', 'source', { reason, requestId }),
    );
    this.reportError(error, createGridEvent('data.load.error', 'source', { reason, requestId }));
  }

  private validateRows(rows: readonly Row[]): void {
    const keys = new Set<string>();
    rows.forEach((row) => {
      const key = this.definition.getRowKey(row);
      const signature = String(key);
      if (keys.has(signature)) throw new Error(`Duplicate row key in grid result: ${signature}`);
      keys.add(signature);
    });
  }

  private correctOutOfRangePage(result: GridReadResult<Row>): boolean {
    const pagination = this.state.query.pagination;
    const total = result.total;
    if (pagination.type !== 'offset' || !total || (total.accuracy && total.accuracy !== 'exact')) {
      return false;
    }
    const lastPage = Math.max(1, Math.ceil(total.value / pagination.pageSize));
    if (pagination.page <= lastPage) return false;
    this.query.setPage(lastPage, 'system');
    return true;
  }

  private normalizeFacets(result: GridReadResult<Row>): GridReadResult<Row> {
    if (!result.facets) return result;
    const facets: Record<string, GridOption[]> = {};
    Object.entries(result.facets).forEach(([key, options]) => {
      const field = this.definition.fields.find(
        (item) => item.id === key || item.transport.filterKey === key,
      );
      facets[field?.id || key] = options;
    });
    return { ...result, facets };
  }

  private reconcileSelection(result: GridReadResult<Row>): GridSelectionState {
    const selection = this.state.selection;
    if (selection.mode === 'explicit') {
      const selected = new Set(selection.selectedKeys);
      result.rows.forEach((row) => {
        const key = this.definition.getRowKey(row);
        if (selected.has(key)) this.selectedRows.set(key, row);
      });

      const source = this.optionsValue.source;
      if (source.mode !== 'local') return selection;
      const available = new Set(source.rows.map(this.definition.getRowKey));
      [...this.selectedRows.keys()].forEach((key) => {
        if (!available.has(key)) this.selectedRows.delete(key);
      });
      if (this.isControlled('selection')) return selection;
      const selectedKeys = selection.selectedKeys.filter((key) => available.has(key));
      return shallowArrayEqual(selectedKeys, selection.selectedKeys)
        ? selection
        : { mode: 'explicit', selectedKeys };
    }

    this.selectedRows.clear();
    const exactTotal =
      result.total && (!result.total.accuracy || result.total.accuracy === 'exact')
        ? result.total.value
        : undefined;
    const currentSignature = this.requestScope();
    if (selection.querySignature !== currentSignature || exactTotal === undefined) {
      return this.isControlled('selection') ? selection : { mode: 'explicit', selectedKeys: [] };
    }

    let excludedKeys = uniqueRowKeys(selection.excludedKeys);
    const source = this.optionsValue.source;
    if (source.mode === 'local') {
      const available = new Set(source.rows.map(this.definition.getRowKey));
      excludedKeys = excludedKeys.filter((key) => available.has(key));
    }
    if (this.isControlled('selection')) return selection;
    return exactTotal === selection.total && shallowArrayEqual(excludedKeys, selection.excludedKeys)
      ? selection
      : { ...selection, total: exactTotal, excludedKeys };
  }

  private notifyControlledQuery(
    event: GridEvent,
    query = this.state.query,
    columns = this.state.columns,
  ): void {
    if (this.destroyed) return;
    const source = this.optionsValue.source;
    if (source.mode === 'controlled') {
      source.onQueryChange?.(query, this.compileRequest(query, columns), event);
    }
  }

  private syncControlledSource(): void {
    const source = this.optionsValue.source;
    if (source.mode !== 'controlled') return;
    let result: GridReadResult<Row>;
    try {
      result = this.normalizeFacets(
        normalizeGridResult(source.result, this.state.query.pagination),
      );
      this.validateRows(result.rows);
    } catch (error) {
      this.applyRequestError(normalizeError(error), 'source');
      return;
    }
    const error = source.error ? normalizeError(source.error) : undefined;
    const data: GridDataState<Row> = {
      ...result,
      status: error ? 'error' : source.loading ? 'loading' : 'success',
      fetching: Boolean(source.loading || source.refreshing),
      error,
      updatedAt: error || source.loading ? this.state.data.updatedAt : Date.now(),
    };
    const selection = this.reconcileSelection(result);
    const current = this.state.data;
    const same =
      current.rows === data.rows &&
      current.total === data.total &&
      current.pageInfo === data.pageInfo &&
      current.summary === data.summary &&
      current.facets === data.facets &&
      current.warnings === data.warnings &&
      current.status === data.status &&
      current.fetching === data.fetching &&
      current.error?.message === data.error?.message;
    if (same && selection === this.state.selection) return;
    this.commit(
      { ...this.internalState, selection, data },
      createGridEvent('data.controlled.sync', 'source'),
    );
  }

  private readCache(
    source: GridRemoteSource<Row>,
    signature: string,
  ): RequestCacheEntry<Row> | undefined {
    const entry = this.requestCache.get(signature);
    if (!entry) return undefined;
    const cacheTime = Math.max(0, source.policy?.cacheTime || 0);
    if (!cacheTime || Date.now() - entry.createdAt > cacheTime) {
      this.requestCache.delete(signature);
      return undefined;
    }
    entry.accessedAt = Date.now();
    return entry;
  }

  private writeCache(
    source: GridRemoteSource<Row>,
    signature: string,
    result: GridReadResult<Row>,
  ): void {
    if (!source.policy?.cacheTime) return;
    const now = Date.now();
    this.requestCache.set(signature, { result, createdAt: now, accessedAt: now });
    const maximum = Math.max(1, source.policy.maxCacheEntries || 20);
    if (this.requestCache.size <= maximum) return;
    const oldest = [...this.requestCache.entries()].sort(
      (left, right) => left[1].accessedAt - right[1].accessedAt,
    )[0];
    if (oldest) this.requestCache.delete(oldest[0]);
  }

  private optionDependency(dependsOn: 'query' | string[] | undefined): string {
    if (!dependsOn) return '';
    if (dependsOn === 'query') return stableStringify(this.state.query);
    const fields = new Set(dependsOn);
    const project = (group: GridFilterGroup): unknown => {
      const children = group.children.flatMap((node) => {
        if (node.type === 'condition') {
          return fields.has(node.fieldId)
            ? [[node.fieldId, node.operator, node.value] as unknown]
            : [];
        }
        const nested = project(node) as { children: unknown[] } | undefined;
        return nested?.children.length ? [nested] : [];
      });
      return children.length
        ? { logic: group.logic, negated: Boolean(group.negated), children }
        : undefined;
    };
    return stableStringify(project(this.state.query.filters));
  }

  private trimOptionCache(): void {
    while (this.optionCache.size > 100) {
      const oldest = this.optionCache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.optionCache.get(oldest)?.controller?.abort();
      this.optionCache.delete(oldest);
    }
  }

  private withViewDirty(state: GridState<Row>): GridState<Row> {
    const active = state.views.activeId
      ? state.views.items.find((view) => view.id === state.views.activeId)
      : undefined;
    if (!active)
      return state.views.dirty ? { ...state, views: { ...state.views, dirty: false } } : state;
    const query: GridQuery = { ...active.query, pagination: state.query.pagination };
    let dirty = true;
    try {
      dirty =
        this.viewQuerySignature(state.query, state.columns) !==
          this.viewQuerySignature(query, active.columns) ||
        stableStringify(state.columns) !== stableStringify(active.columns);
    } catch {
      dirty = true;
    }
    return dirty === state.views.dirty ? state : { ...state, views: { ...state.views, dirty } };
  }

  private reconcileColumns(columns: GridColumnState): GridColumnState {
    const known = new Set(leafColumns(this.definition.columns).map((column) => column.id));
    const order = uniqueStrings(columns.order.filter((id) => known.has(id)));
    this.defaultColumns.order.forEach((id) => {
      if (!order.includes(id)) order.push(id);
    });
    return {
      order,
      hidden: uniqueStrings([
        ...columns.hidden.filter((id) => known.has(id)),
        ...this.defaultColumns.hidden.filter((id) => !columns.order.includes(id)),
      ]),
      widths: Object.fromEntries(
        order.map((id) => [id, columns.widths[id] || this.defaultColumns.widths[id] || 160]),
      ),
      pinned: Object.fromEntries(
        order.map((id) => [
          id,
          Object.prototype.hasOwnProperty.call(columns.pinned, id)
            ? columns.pinned[id] || null
            : this.defaultColumns.pinned[id] || null,
        ]),
      ),
      density: columns.density || this.defaultColumns.density,
    };
  }

  private schedulePersistence(): void {
    if (!this.optionsValue.persistence || this.destroyed) return;
    if (this.persistenceTimer) clearTimeout(this.persistenceTimer);
    const generation = this.persistenceGeneration;
    this.persistenceTimer = setTimeout(() => {
      this.persistenceTimer = undefined;
      if (generation === this.persistenceGeneration) void this.persist();
    }, 250);
  }

  private createPersistedState(
    state: GridState<Row>,
    definition: GridResolvedDefinition<Row>,
  ): GridPersistedState {
    return {
      protocol: 'huiyun.data-grid/preferences/v1',
      gridId: definition.id,
      revision: definition.revision,
      columns: cloneColumnState(state.columns),
      views: cloneJson(state.views.items),
      activeViewId: state.views.activeId,
      updatedAt: new Date().toISOString(),
    };
  }

  private enqueuePersistenceSave(
    persistence: GridPersistence<Row>,
    state: GridPersistedState,
    definition: GridResolvedDefinition<Row>,
  ): Promise<void> {
    const identity = this.getPersistenceIdentity(persistence);
    const previous = this.persistenceSaveChains.get(identity) || Promise.resolve();
    const next = previous.then(async () => {
      try {
        await persistence.save(definition.id, state, { definition });
      } catch (error) {
        const normalized = normalizeError(error, 'Unable to save grid preferences.');
        this.reportError(normalized, createGridEvent('persistence.save.error', 'source'));
      }
    });
    const tracked = next.finally(() => {
      if (this.persistenceSaveChains.get(identity) === tracked) {
        this.persistenceSaveChains.delete(identity);
      }
    });
    this.persistenceSaveChains.set(identity, tracked);
    return tracked;
  }

  private flushPendingPersistence(
    persistence: GridOptions<Row>['persistence'],
    state: GridState<Row>,
    definition: GridResolvedDefinition<Row>,
  ): void {
    if (!this.persistenceTimer) return;
    clearTimeout(this.persistenceTimer);
    this.persistenceTimer = undefined;
    if (persistence) {
      void this.enqueuePersistenceSave(
        persistence,
        this.createPersistedState(state, definition),
        definition,
      );
    }
  }

  private restorePersistenceOnce(): Promise<boolean> {
    if (this.persistenceRestored) return Promise.resolve(false);
    if (this.persistencePromise) return this.persistencePromise;
    const persistence = this.optionsValue.persistence;
    if (!persistence) {
      this.persistenceRestored = true;
      return Promise.resolve(false);
    }
    const generation = this.persistenceGeneration;
    const promise = this.restorePersistence(persistence, generation).then((requestChanged) => {
      if (
        generation === this.persistenceGeneration &&
        this.getPersistenceIdentity(this.optionsValue.persistence) === this.persistenceIdentity &&
        this.started &&
        !this.destroyed
      ) {
        this.persistenceRestored = true;
        return requestChanged;
      }
      return false;
    });
    const tracked = promise.finally(() => {
      if (this.persistencePromise === tracked) this.persistencePromise = undefined;
    });
    this.persistencePromise = tracked;
    return tracked;
  }

  private async persist(): Promise<void> {
    const persistence = this.optionsValue.persistence;
    if (!persistence) return;
    const definition = this.definition;
    await this.enqueuePersistenceSave(
      persistence,
      this.createPersistedState(this.state, definition),
      definition,
    );
  }

  private async restorePersistence(
    persistence: GridPersistence<Row>,
    generation: number,
  ): Promise<boolean> {
    const definition = this.definition;
    const sessionIsCurrent = () =>
      generation === this.persistenceGeneration &&
      this.getPersistenceIdentity(this.optionsValue.persistence) === this.persistenceIdentity &&
      this.started &&
      !this.destroyed;
    try {
      const loaded = await persistence.load(definition.id, { definition });
      if (!sessionIsCurrent() || !loaded) return false;
      let persisted: GridPersistedState | null = parseGridPersistedState(loaded);
      if (
        persisted.protocol !== 'huiyun.data-grid/preferences/v1' ||
        persisted.gridId !== definition.id
      ) {
        return false;
      }
      if (persisted.revision !== definition.revision) {
        const migrated = persistence.migrate
          ? await persistence.migrate(persisted, { definition })
          : null;
        persisted = migrated ? parseGridPersistedState(migrated) : null;
      }
      if (!sessionIsCurrent() || !persisted) return false;
      if (
        persisted.protocol !== 'huiyun.data-grid/preferences/v1' ||
        persisted.gridId !== definition.id ||
        persisted.revision !== definition.revision
      ) {
        throw new Error('Migrated grid preferences do not match the current grid revision.');
      }

      const active = persisted.activeViewId
        ? persisted.views.find((view) => view.id === persisted.activeViewId)
        : undefined;
      const columns = this.reconcileColumns(active?.columns || persisted.columns);
      const pagination = this.resetPagination(this.state.query.pagination);
      const query: GridQuery = active
        ? { ...cloneJson(active.query), pagination }
        : this.state.query;
      validateGridQuery(query, definition, this.capabilities);
      const previousRequest = getRequestSignature(this.compileRequest());
      const previousScope = this.requestScope();
      const nextScope = this.requestScope(query, columns);
      if (previousScope !== nextScope) this.selectedRows.clear();
      const next: GridState<Row> = {
        ...this.internalState,
        query,
        columns,
        selection:
          previousScope !== nextScope && !this.isControlled('selection')
            ? { mode: 'explicit', selectedKeys: [] }
            : this.internalState.selection,
        views: {
          activeId: active?.id,
          items: persisted.views,
          dirty: false,
        },
      };
      this.commit(next, createGridEvent('persistence.restore', 'restore'));
      return previousRequest !== getRequestSignature(this.compileRequest());
    } catch (error) {
      if (!sessionIsCurrent()) return false;
      const normalized = normalizeError(error, 'Unable to restore grid preferences.');
      this.reportError(normalized, createGridEvent('persistence.load.error', 'source'));
      return false;
    }
  }

  private reportError(error: Error, event: GridEvent): void {
    if (this.destroyed) return;
    this.optionsValue.onError?.(error, event);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

function validateStateContainer(value: unknown, label: string): void {
  if (value === undefined) return;
  if (!isPlainRecord(value)) throw new Error(`${label} must be an object.`);
  for (const slice of ['query', 'columns', 'selection', 'data', 'views', 'editing', 'actions']) {
    if (Object.prototype.hasOwnProperty.call(value, slice) && !isPlainRecord(value[slice])) {
      throw new Error(`${label}.${slice} must be an object.`);
    }
  }
}

function validateColumnState<Row extends object>(
  value: unknown,
  label: string,
  definition: GridResolvedDefinition<Row>,
): asserts value is GridColumnState {
  if (!isPlainRecord(value)) throw new Error(`${label} must be an object.`);
  const known = new Set(
    [...definition.columnMap.values()]
      .filter((column) => !column.children?.length)
      .map((column) => column.id),
  );
  for (const key of ['order', 'hidden'] as const) {
    const ids = value[key];
    if (
      !Array.isArray(ids) ||
      ids.some((id) => typeof id !== 'string' || !known.has(id)) ||
      new Set(ids).size !== ids.length
    ) {
      throw new Error(`${label}.${key} must contain unique known leaf column ids.`);
    }
  }
  if (!isPlainRecord(value.widths) || !isPlainRecord(value.pinned)) {
    throw new Error(`${label} widths and pinned values must be objects.`);
  }
  if (
    Object.entries(value.widths).some(
      ([id, width]) =>
        !known.has(id) || typeof width !== 'number' || !Number.isFinite(width) || width <= 0,
    )
  ) {
    throw new Error(`${label}.widths contains an invalid column width.`);
  }
  if (
    Object.entries(value.pinned).some(
      ([id, pinned]) =>
        !known.has(id) || (pinned !== null && pinned !== 'left' && pinned !== 'right'),
    )
  ) {
    throw new Error(`${label}.pinned contains an invalid pinned column.`);
  }
  if (!['compact', 'default', 'comfortable'].includes(String(value.density))) {
    throw new Error(`${label}.density is invalid.`);
  }
}

function validateRowKeys<Row extends object>(
  rows: readonly Row[],
  label: string,
  definition: GridResolvedDefinition<Row>,
): void {
  const keys = new Set<string>();
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`${label}[${index}] must be a row object.`);
    }
    const signature = String(definition.getRowKey(row));
    if (keys.has(signature)) throw new Error(`${label} contains duplicate row key ${signature}.`);
    keys.add(signature);
  });
}

function validateKeyList(value: unknown, label: string): asserts value is GridRowKey[] {
  if (!Array.isArray(value) || value.some((key) => !isValidGridRowKey(key))) {
    throw new Error(`${label} must contain valid row keys.`);
  }
  const signatures = value.map((key) => `${typeof key}:${String(key)}`);
  if (new Set(signatures).size !== signatures.length) {
    throw new Error(`${label} cannot contain duplicate row keys.`);
  }
}

function validateSelectionState(
  value: unknown,
  label: string,
): asserts value is GridSelectionState {
  if (!isPlainRecord(value)) throw new Error(`${label} must be an object.`);
  if (value.mode === 'explicit') {
    validateKeyList(value.selectedKeys, `${label}.selectedKeys`);
    return;
  }
  if (value.mode !== 'allMatching') throw new Error(`${label}.mode is invalid.`);
  validateKeyList(value.excludedKeys, `${label}.excludedKeys`);
  if (
    typeof value.querySignature !== 'string' ||
    !value.querySignature ||
    !Number.isSafeInteger(value.total) ||
    (value.total as number) < 0 ||
    (value.excludedKeys as GridRowKey[]).length > (value.total as number)
  ) {
    throw new Error(`${label} all-matching metadata is invalid.`);
  }
}

function validateFilterShape(value: unknown, ids: Set<string>, root = false): void {
  if (!isPlainRecord(value) || typeof value.id !== 'string' || !value.id || ids.has(value.id)) {
    throw new Error('Grid view query contains invalid or duplicate filter ids.');
  }
  ids.add(value.id);
  if (value.type === 'condition') {
    if (
      root ||
      typeof value.fieldId !== 'string' ||
      !value.fieldId ||
      typeof value.operator !== 'string' ||
      !value.operator ||
      (value.value !== undefined && !isGridJsonValue(value.value))
    ) {
      throw new Error('Grid view query contains an invalid filter condition.');
    }
    return;
  }
  if (
    value.type !== 'group' ||
    (value.logic !== 'and' && value.logic !== 'or') ||
    (value.negated !== undefined && typeof value.negated !== 'boolean') ||
    !Array.isArray(value.children)
  ) {
    throw new Error('Grid view query contains an invalid filter group.');
  }
  value.children.forEach((child) => validateFilterShape(child, ids));
}

function validateViewState<Row extends object>(
  value: unknown,
  label: string,
  definition: GridResolvedDefinition<Row>,
): void {
  if (
    !isPlainRecord(value) ||
    !Array.isArray(value.items) ||
    typeof value.dirty !== 'boolean' ||
    (value.activeId !== undefined && (typeof value.activeId !== 'string' || !value.activeId))
  ) {
    throw new Error(`${label} does not match the grid view state protocol.`);
  }
  const ids = new Set<string>();
  value.items.forEach((view, index) => {
    if (
      !isPlainRecord(view) ||
      typeof view.id !== 'string' ||
      !view.id ||
      ids.has(view.id) ||
      typeof view.name !== 'string' ||
      !view.name.trim() ||
      !isPlainRecord(view.query)
    ) {
      throw new Error(`${label}.items[${index}] is invalid.`);
    }
    ids.add(view.id);
    const query = view.query;
    if (typeof query.keyword !== 'string' || !Array.isArray(query.sorts)) {
      throw new Error(`${label}.items[${index}].query is invalid.`);
    }
    validateFilterShape(query.filters, new Set(), true);
    validateColumnState(view.columns, `${label}.items[${index}].columns`, definition);
  });
  if (value.activeId !== undefined && !ids.has(value.activeId)) {
    throw new Error(`${label}.activeId must reference an existing view.`);
  }
}

function validateDataState<Row extends object>(
  value: unknown,
  label: string,
  definition: GridResolvedDefinition<Row>,
): void {
  if (
    !isPlainRecord(value) ||
    !['idle', 'loading', 'success', 'error'].includes(String(value.status)) ||
    typeof value.fetching !== 'boolean' ||
    !Array.isArray(value.rows) ||
    !Array.isArray(value.summary) ||
    !isPlainRecord(value.facets) ||
    !Array.isArray(value.warnings)
  ) {
    throw new Error(`${label} does not match the grid data state protocol.`);
  }
  validateRowKeys(value.rows as Row[], `${label}.rows`, definition);
  Object.entries(value.facets).forEach(([fieldId, options]) => {
    normalizeGridOptions(options, `${label}.facets.${fieldId}`);
  });
  if (value.total !== undefined) {
    if (
      !isPlainRecord(value.total) ||
      !Number.isSafeInteger(value.total.value) ||
      (value.total.value as number) < 0 ||
      (value.total.accuracy !== undefined &&
        !['exact', 'estimated', 'atLeast'].includes(String(value.total.accuracy)))
    ) {
      throw new Error(`${label}.total is invalid.`);
    }
  }
  if (value.error !== undefined && !(value.error instanceof Error)) {
    throw new Error(`${label}.error must be an Error.`);
  }
}

function uniqueRowKeys(values: readonly GridRowKey[]): GridRowKey[] {
  return [...new Set(values)];
}

function isValidGridRowKey(value: unknown): value is GridRowKey {
  return (
    (typeof value === 'string' && value.length > 0) ||
    (typeof value === 'number' && Number.isSafeInteger(value))
  );
}

export function createGrid<Row extends object>(options: GridOptions<Row>): GridInstance<Row> {
  return new GridStore(options);
}
