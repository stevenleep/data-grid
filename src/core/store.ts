import { resolveGridDefinition } from './definition';
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
import { applyLocalGridQuery, compileGridQuery, validateGridQuery } from './query';
import { normalizeGridResult, resolveGridCapabilities, sourceDataIdentity } from './source';
import type {
  GridAction,
  GridActionContext,
  GridActionPlacement,
  GridActionsApi,
  GridColumnState,
  GridDataState,
  GridDensity,
  GridEvent,
  GridEventReason,
  GridFilterGroup,
  GridInstance,
  GridOption,
  GridOptions,
  GridPagination,
  GridPersistedState,
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
  value?: GridOption[];
  promise?: Promise<GridOption[]>;
  controller?: AbortController;
  createdAt: number;
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
  readonly definition: GridResolvedDefinition<Row>;
  capabilities: GridResolvedCapabilities;
  private optionsValue: GridOptions<Row>;
  private state: GridState<Row>;
  private internalState: GridState<Row>;
  private readonly defaultQuery: GridQuery;
  private readonly defaultColumns: GridColumnState;
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(event: GridEvent) => void>();
  private selectedRows = new Map<GridRowKey, Row>();
  private requestCache = new Map<string, RequestCacheEntry<Row>>();
  private optionCache = new Map<string, OptionCacheEntry>();
  private actionControllers = new Map<string, AbortController>();
  private editController?: AbortController;
  private editRollback?: { key: GridRowKey; row: Row };
  private requestController?: AbortController;
  private requestPromise?: Promise<void>;
  private activeRequestSignature?: string;
  private requestId = 0;
  private started = false;
  private destroyed = false;
  private lifecycleId = 0;
  private persistenceTimer?: ReturnType<typeof setTimeout>;
  private persistenceRestored = false;
  private persistencePromise?: Promise<void>;
  private batchDepth = 0;
  private pendingChanged = false;
  private pendingEvent?: GridEvent;
  private pendingState?: GridState<Row>;
  private pendingPersist = false;
  private pendingLoad?: { force: boolean; reason: GridRequestReason };
  private sourceIdentity: unknown[];

  constructor(options: GridOptions<Row>) {
    this.optionsValue = options;
    this.definition = resolveGridDefinition(options.definition);
    this.capabilities = resolveGridCapabilities(options.source);
    this.sourceIdentity = sourceDataIdentity(options.source);
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
    this.internalState = {
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
    this.state = mergeControlledState(this.internalState, options.state);
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
    const resolved = resolveGridDefinition(options.definition);
    if (resolved.id !== this.definition.id || resolved.revision !== this.definition.revision) {
      throw new Error('Changing a grid definition requires a new GridInstance.');
    }

    const previousState = this.state;
    const previousSourceMode = this.optionsValue.source.mode;
    const previousSourceIdentity = this.sourceIdentity;
    this.optionsValue = options;
    this.capabilities = resolveGridCapabilities(options.source);
    this.sourceIdentity = sourceDataIdentity(options.source);
    if (options.state) this.internalState = { ...this.internalState, ...options.state };

    let next = mergeControlledState(this.internalState, options.state);
    if (next.query.pagination.type !== this.capabilities.pagination) {
      const pageSize = next.query.pagination.pageSize;
      const pagination: GridPagination =
        this.capabilities.pagination === 'cursor'
          ? { type: 'cursor', pageSize }
          : { type: 'offset', page: 1, pageSize };
      next = { ...next, query: { ...next.query, pagination } };
      this.internalState = { ...this.internalState, query: next.query };
    }
    validateGridQuery(next.query, this.definition, this.capabilities);
    this.state = next;
    if (!sameState(previousState, next)) this.listeners.forEach((listener) => listener());

    const queryChanged = previousState.query !== next.query;
    const columnsChanged = previousState.columns !== next.columns;
    const sourceChanged = !shallowArrayEqual(previousSourceIdentity, this.sourceIdentity);
    if (
      queryChanged &&
      previousState.selection === next.selection &&
      !this.isControlled('selection')
    ) {
      const beforeScope = this.requestScope(previousState.query, previousState.columns);
      const afterScope = this.requestScope(next.query, next.columns);
      if (beforeScope !== afterScope) this.clearSelection('system');
    }
    if (!this.started) return;
    if (sourceChanged || previousSourceMode !== options.source.mode) {
      this.requestCache.clear();
    }
    if (options.source.mode === 'controlled') {
      if (sourceChanged || previousSourceMode !== options.source.mode) {
        this.syncControlledSource();
      }
      if (queryChanged || previousSourceMode !== options.source.mode) {
        this.notifyControlledQuery(createGridEvent('query.external', 'source'));
      }
    } else if (sourceChanged || previousSourceMode !== options.source.mode) {
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
    if (!this.started) return;
    this.started = false;
    this.lifecycleId += 1;
    this.requestController?.abort();
    this.requestController = undefined;
    this.requestPromise = undefined;
    this.activeRequestSignature = undefined;
    this.editController?.abort();
    this.editController = undefined;
    this.rollbackOptimisticEdit();
    this.actionControllers.forEach((controller) => controller.abort());
    this.actionControllers.clear();
    this.optionCache.forEach((entry, key) => {
      entry.controller?.abort();
      if (entry.promise) this.optionCache.delete(key);
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
      const validKeys = keys.filter(
        (key): key is GridRowKey => typeof key === 'string' || typeof key === 'number',
      );
      rows.forEach((row) => this.selectedRows.set(this.definition.getRowKey(row), row));
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
      const current = this.selection.isSelected(key);
      const nextSelected = selected ?? !current;
      this.selectedRows.set(key, row);
      if (this.state.selection.mode === 'allMatching') {
        const excluded = new Set(this.state.selection.excludedKeys);
        if (nextSelected) excluded.delete(key);
        else excluded.add(key);
        this.setSelection({ ...this.state.selection, excludedKeys: [...excluded] });
        return;
      }
      const keys = new Set(this.state.selection.selectedKeys);
      if (nextSelected) keys.add(key);
      else {
        keys.delete(key);
        this.selectedRows.delete(key);
      }
      this.setSelection({ mode: 'explicit', selectedKeys: [...keys] });
    },
    selectPage: (rows: readonly Row[] = this.state.data.rows) => {
      const keys = rows.map(this.definition.getRowKey);
      rows.forEach((row) => this.selectedRows.set(this.definition.getRowKey(row), row));
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
        : !selection.excludedKeys.includes(key);
    },
    getCount: () => {
      const selection = this.state.selection;
      return selection.mode === 'explicit'
        ? selection.selectedKeys.length
        : Math.max(0, selection.total - selection.excludedKeys.length);
    },
    getSelectedRows: () => {
      if (this.state.selection.mode === 'allMatching') return [];
      return this.state.selection.selectedKeys
        .map((key) => this.selectedRows.get(key))
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
      this.selectedRows.clear();
      this.commit(
        {
          ...this.internalState,
          query,
          columns,
          selection: { mode: 'explicit', selectedKeys: [] },
          views: { ...this.state.views, activeId: view?.id, dirty: false },
        },
        createGridEvent('views.apply', 'user', { id }),
        true,
      );
      this.queueLoad(false, 'query');
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
          },
        },
        createGridEvent('editing.draft', 'user'),
      );
    },
    commit: async () => {
      const active = this.state.editing.active;
      const editing = this.definition.editing;
      if (!active || !editing || this.state.editing.saving) return false;
      const field = this.definition.fieldMap.get(active.fieldId);
      const row = this.state.data.rows.find(
        (item) => this.definition.getRowKey(item) === active.rowKey,
      );
      if (!field || !row) return false;
      if (field.edit && field.edit.required && field.isEmpty(active.draft)) {
        this.setEditingError('This field is required.');
        return false;
      }
      this.editController?.abort();
      const controller = new AbortController();
      this.editController = controller;
      this.commit(
        {
          ...this.internalState,
          editing: { ...this.state.editing, saving: true, error: undefined },
        },
        createGridEvent('editing.save.start', 'user'),
      );
      let optimisticRow: Row | undefined;
      try {
        const validation = await field.validate?.(active.draft, row);
        if (controller.signal.aborted) return false;
        if (typeof validation === 'string' && validation) {
          this.setEditingError(validation);
          return false;
        }
        optimisticRow =
          editing.optimistic && editing.apply ? editing.apply(row, field, active.draft) : undefined;
        if (optimisticRow) {
          this.editRollback = { key: active.rowKey, row };
          this.data.updateRow(active.rowKey, optimisticRow);
        }
        const result = await editing.save({
          row,
          rowKey: active.rowKey,
          field,
          previousValue: active.previousValue,
          value: active.draft,
          signal: controller.signal,
          instance: this,
        });
        if (controller.signal.aborted) return false;
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
        this.setEditingError(normalized.message);
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
        await action.run(context);
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
    key: (actionId: string, row?: Row) =>
      row ? `${actionId}:${String(this.definition.getRowKey(row))}` : actionId,
  };

  options = {
    load: async (fieldId: string, search = '') => {
      const field = this.definition.fieldMap.get(fieldId);
      if (!field) throw new Error(`Unknown grid field: ${fieldId}`);
      const normalizedSearch = search.trim().toLocaleLowerCase();
      if (!normalizedSearch) {
        const facet = this.state.data.facets?.[fieldId];
        if (facet?.length) return facet;
      }
      if (!field.options) return [];
      if (Array.isArray(field.options)) {
        return normalizedSearch
          ? field.options.filter((option) =>
              String(option.label).toLocaleLowerCase().includes(normalizedSearch),
            )
          : field.options;
      }
      const provider =
        typeof field.options === 'function' ? { load: field.options } : field.options;
      const dependency = this.optionDependency(provider.dependsOn);
      const key = `${fieldId}:${normalizedSearch}:${dependency}`;
      const cached = this.optionCache.get(key);
      const cacheTime = provider.cacheTime ?? 30_000;
      if (cached?.value && Date.now() - cached.createdAt <= cacheTime) return cached.value;
      if (cached?.promise) return cached.promise;

      const controller = new AbortController();
      const promise = provider
        .load({ field, query: this.state.query, search, signal: controller.signal })
        .then((items) => {
          const value = Array.isArray(items) ? items : [];
          this.optionCache.set(key, { value, createdAt: Date.now() });
          this.trimOptionCache();
          return value;
        })
        .catch((error) => {
          this.optionCache.delete(key);
          if (controller.signal.aborted) return [];
          throw error;
        });
      this.optionCache.set(key, { promise, controller, createdAt: Date.now() });
      return promise;
    },
    clear: (fieldId?: string) => {
      [...this.optionCache.entries()].forEach(([key, entry]) => {
        if (!fieldId || key.startsWith(`${fieldId}:`)) {
          entry.controller?.abort();
          this.optionCache.delete(key);
        }
      });
    },
  };

  private isControlled(slice: keyof GridState<Row>): boolean {
    return Boolean(
      this.optionsValue.state &&
      Object.prototype.hasOwnProperty.call(this.optionsValue.state, slice),
    );
  }

  private rollbackOptimisticEdit(): void {
    const rollback = this.editRollback;
    this.editRollback = undefined;
    if (rollback) this.data.updateRow(rollback.key, rollback.row);
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
    const previousRequest = this.compileRequest(this.state.query, this.state.columns);
    const next = this.withViewDirty({ ...this.internalState, columns });
    const previousColumns = this.state.columns;
    this.commit(next, event, true);
    if (this.state.columns !== previousColumns && this.capabilities.projection) {
      const nextRequest = this.compileRequest(this.state.query, this.state.columns);
      if (getRequestSignature(previousRequest) !== getRequestSignature(nextRequest)) {
        this.queueLoad(false, 'projection');
      }
    }
  }

  private setSelection(selection: GridSelectionState): void {
    this.commit({ ...this.internalState, selection }, createGridEvent('selection.change', 'user'));
  }

  private clearSelection(reason: GridEventReason): void {
    this.selectedRows.clear();
    this.commit(
      { ...this.internalState, selection: { mode: 'explicit', selectedKeys: [] } },
      createGridEvent('selection.clear', reason),
    );
  }

  private setEditingError(error: string): void {
    this.commit(
      {
        ...this.internalState,
        editing: { ...this.state.editing, saving: false, error },
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

  private visibleFieldIds(columns: GridColumnState, explicit?: string[]): string[] {
    if (explicit?.length) return explicit;
    const hidden = new Set(columns.hidden);
    return columns.order
      .filter((id) => !hidden.has(id))
      .map((id) => this.definition.columnMap.get(id)?.fieldId)
      .filter((id): id is string => Boolean(id));
  }

  private requestScope(query = this.state.query, columns = this.state.columns): string {
    return getRequestScopeSignature(this.compileRequest(query, columns));
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
        const result = applyLocalGridQuery(source.rows, query, this.definition);
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
        const result = normalizeGridResult(
          await source.read({
            query,
            request,
            fields: this.definition.fields,
            signal: controller.signal,
            requestId,
            reason,
          }),
        );
        if (controller.signal.aborted || requestId !== this.requestId || this.destroyed) return;
        this.validateRows(result.rows);
        if (this.correctOutOfRangePage(result)) return;
        this.writeCache(source, signature, result);
        this.applyResult(result, { requestId }, reason);
      } catch (error) {
        if (controller.signal.aborted || requestId !== this.requestId || this.destroyed) return;
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
    const result = this.normalizeFacets(normalizeGridResult(input));
    this.validateRows(result.rows);
    this.commit(
      {
        ...this.internalState,
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
    const keys = new Set<GridRowKey>();
    rows.forEach((row) => {
      const key = this.definition.getRowKey(row);
      if (keys.has(key)) throw new Error(`Duplicate row key in grid result: ${String(key)}`);
      keys.add(key);
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

  private notifyControlledQuery(
    event: GridEvent,
    query = this.state.query,
    columns = this.state.columns,
  ): void {
    const source = this.optionsValue.source;
    if (source.mode === 'controlled') {
      source.onQueryChange?.(query, this.compileRequest(query, columns), event);
    }
  }

  private syncControlledSource(): void {
    const source = this.optionsValue.source;
    if (source.mode !== 'controlled') return;
    const result = this.normalizeFacets(normalizeGridResult(source.result));
    try {
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
    if (same) return;
    this.commit({ ...this.internalState, data }, createGridEvent('data.controlled.sync', 'source'));
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
    if (dependsOn === 'query') return this.requestScope();
    const fields = new Set(dependsOn);
    const values: unknown[] = [];
    const visit = (group: GridFilterGroup) => {
      group.children.forEach((node) => {
        if (node.type === 'group') visit(node);
        else if (fields.has(node.fieldId)) values.push([node.fieldId, node.operator, node.value]);
      });
    };
    visit(this.state.query.filters);
    return stableStringify(values);
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
    this.persistenceTimer = setTimeout(() => {
      this.persistenceTimer = undefined;
      void this.persist();
    }, 250);
  }

  private restorePersistenceOnce(): Promise<void> {
    if (this.persistenceRestored) return Promise.resolve();
    if (this.persistencePromise) return this.persistencePromise;
    this.persistencePromise = this.restorePersistence().finally(() => {
      this.persistenceRestored = true;
      this.persistencePromise = undefined;
    });
    return this.persistencePromise;
  }

  private async persist(): Promise<void> {
    const persistence = this.optionsValue.persistence;
    if (!persistence) return;
    const state: GridPersistedState = {
      protocol: 'huiyun.data-grid/preferences/v1',
      gridId: this.definition.id,
      revision: this.definition.revision,
      columns: this.state.columns,
      views: this.state.views.items,
      activeViewId: this.state.views.activeId,
      updatedAt: new Date().toISOString(),
    };
    try {
      await persistence.save(this.definition.id, state, { definition: this.definition });
    } catch (error) {
      const normalized = normalizeError(error, 'Unable to save grid preferences.');
      this.reportError(normalized, createGridEvent('persistence.save.error', 'source'));
    }
  }

  private async restorePersistence(): Promise<void> {
    const persistence = this.optionsValue.persistence;
    if (!persistence) return;
    try {
      let persisted = await persistence.load(this.definition.id, { definition: this.definition });
      if (!persisted) return;
      if (
        persisted.protocol !== 'huiyun.data-grid/preferences/v1' ||
        persisted.gridId !== this.definition.id
      ) {
        return;
      }
      if (persisted.revision !== this.definition.revision) {
        persisted = persistence.migrate
          ? await persistence.migrate(persisted, { definition: this.definition })
          : null;
      }
      if (!persisted) return;
      const columns = this.reconcileColumns(persisted.columns);
      const next = {
        ...this.internalState,
        columns,
        views: {
          activeId: persisted.views.some((view) => view.id === persisted.activeViewId)
            ? persisted.activeViewId
            : undefined,
          items: persisted.views || [],
          dirty: false,
        },
      };
      this.commit(next, createGridEvent('persistence.restore', 'restore'));
    } catch (error) {
      const normalized = normalizeError(error, 'Unable to restore grid preferences.');
      this.reportError(normalized, createGridEvent('persistence.load.error', 'source'));
    }
  }

  private reportError(error: Error, event: GridEvent): void {
    this.optionsValue.onError?.(error, event);
  }
}

function uniqueRowKeys(values: readonly GridRowKey[]): GridRowKey[] {
  return [...new Set(values)];
}

export function createGrid<Row extends object>(options: GridOptions<Row>): GridInstance<Row> {
  return new GridStore(options);
}
