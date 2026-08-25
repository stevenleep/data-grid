import { describe, expect, it, vi } from 'vitest';
import {
  createControlledSource,
  createGrid,
  createLocalSource,
  createRemoteSource,
  type GridColumnState,
  type GridPersistence,
  type GridDefinition,
  type GridPersistedState,
  type GridQuery,
  type GridReadResult,
  type GridState,
} from '../src/core';

interface Row {
  id: number;
  name: string;
}

const rows: Row[] = [
  { id: 1, name: 'One' },
  { id: 2, name: 'Two' },
  { id: 3, name: 'Three' },
];

function definition(overrides: Partial<GridDefinition<Row>> = {}): GridDefinition<Row> {
  return {
    id: 'store-test',
    revision: 1,
    rowKey: 'id',
    fields: [{ id: 'name', title: 'Name', filter: true, sort: true, edit: true }],
    defaults: { pageSize: 1, selection: true, views: true },
    ...overrides,
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function offsetQuery(page: number): GridQuery {
  return {
    pagination: { type: 'offset', page, pageSize: 1 },
    keyword: '',
    filters: { id: 'root', type: 'group', logic: 'and', children: [] },
    sorts: [],
  };
}

function offsetPageData(page: number) {
  return {
    rows: [rows[page - 1]!],
    total: { value: rows.length, accuracy: 'exact' as const },
    pageInfo: { hasPrevious: page > 1, hasNext: page < rows.length },
  };
}

function controlledOffsetPageData(page: number): GridState<Row>['data'] {
  return {
    ...offsetPageData(page),
    status: 'success',
    fetching: false,
    summary: [],
    facets: {},
    warnings: [],
  };
}

describe('grid store', () => {
  it('supports pagination-first local data and cross-page selection', async () => {
    const grid = createGrid<Row>({
      definition: definition(),
      source: createLocalSource(rows),
    });
    await grid.start();
    expect(grid.getState().data.rows.map((row) => row.id)).toEqual([1]);

    grid.selection.selectPage();
    grid.query.setPage(2);
    expect(grid.getState().data.rows.map((row) => row.id)).toEqual([2]);
    grid.selection.selectPage();
    expect(grid.getState().selection).toEqual({ mode: 'explicit', selectedKeys: [1, 2] });

    grid.selection.selectAllMatching();
    expect(grid.selection.getCount()).toBe(3);
    grid.selection.toggle(2, rows[1]!, false);
    expect(grid.selection.getCount()).toBe(2);
    expect(grid.selection.isSelected(2)).toBe(false);
    grid.destroy();
  });

  it('aborts stale remote reads and only commits the latest result', async () => {
    const pending: Array<{
      signal: AbortSignal;
      request: ReturnType<typeof deferred<GridReadResult<Row>>>;
    }> = [];
    const read = vi.fn(({ signal }: { signal: AbortSignal }) => {
      const request = deferred<GridReadResult<Row>>();
      pending.push({ signal, request });
      return request.promise;
    });
    const grid = createGrid<Row>({
      definition: definition(),
      source: createRemoteSource(read),
    });

    const initial = grid.start();
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    grid.query.setKeyword('latest');
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[0]!.signal.aborted).toBe(true);

    pending[0]!.request.resolve({ rows: [{ id: 1, name: 'Stale' }] });
    pending[1]!.request.resolve({
      rows: [{ id: 2, name: 'Latest' }],
      total: { value: 1, accuracy: 'exact' },
    });
    await initial;
    await vi.waitFor(() => expect(grid.getState().data.rows[0]?.name).toBe('Latest'));
    grid.destroy();
  });

  it('drops stale pageInfo before a kept-data pagination request can trigger a rerender', async () => {
    const pending: Array<ReturnType<typeof deferred<GridReadResult<Row>>>> = [];
    const read = vi.fn(() => {
      const request = deferred<GridReadResult<Row>>();
      pending.push(request);
      return request.promise;
    });
    const gridDefinition = definition();
    const source = createRemoteSource(read, {
      datasetKey: 'stable-pagination',
      policy: { keepPreviousData: true },
    });
    const options = { definition: gridDefinition, source };
    const grid = createGrid<Row>(options);

    const initial = grid.start();
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending[0]!.resolve({
      rows: [rows[0]!],
      total: { value: 3, accuracy: 'exact' },
      pageInfo: { hasPrevious: false, hasNext: true },
    });
    await initial;

    grid.query.setPage(2, 'user');
    expect(grid.getState().data.rows).toEqual([rows[0]]);
    expect(grid.getState().data.pageInfo).toBeUndefined();
    expect(() => grid.updateOptions(options)).not.toThrow();

    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1]!.resolve({
      rows: [rows[1]!],
      total: { value: 3, accuracy: 'exact' },
      pageInfo: { hasPrevious: true, hasNext: true },
    });
    await vi.waitFor(() => expect(grid.getState().data.rows).toEqual([rows[1]]));
    grid.destroy();
  });

  it('drops stale pageInfo when a parent accepts a controlled pagination request', () => {
    const gridDefinition = definition();
    const source = createRemoteSource<Row>(async () => ({ rows: [] }), {
      datasetKey: 'controlled-query-pagination',
    });
    const grid = createGrid<Row>({
      definition: gridDefinition,
      source,
      state: { query: offsetQuery(1) },
      stateDatasetKey: 'controlled-query-pagination',
      defaultState: { data: offsetPageData(1) },
    });

    expect(() =>
      grid.updateOptions({
        definition: gridDefinition,
        source,
        state: { query: offsetQuery(2) },
        stateDatasetKey: 'controlled-query-pagination',
      }),
    ).not.toThrow();
    expect(grid.getState().query.pagination).toEqual({ type: 'offset', page: 2, pageSize: 1 });
    expect(grid.getState().data.pageInfo).toBeUndefined();
    grid.destroy();
  });

  it('drops stale pageInfo when applying a view resets pagination', () => {
    const grid = createGrid<Row>({
      definition: definition(),
      source: createRemoteSource<Row>(async () => ({ rows: [] })),
      defaultState: { query: { pagination: offsetQuery(2).pagination }, data: offsetPageData(2) },
    });
    const view = grid.views.create('Reset pagination')!;

    grid.views.apply(view.id);

    expect(grid.getState().query.pagination).toEqual({ type: 'offset', page: 1, pageSize: 1 });
    expect(grid.getState().data.pageInfo).toBeUndefined();
    grid.destroy();
  });

  it('drops stale pageInfo when a persistence identity restores the preference baseline', () => {
    const gridDefinition = definition();
    const source = createRemoteSource<Row>(async () => ({ rows: [] }));
    const persistence = (identity: string): GridPersistence<Row> => ({
      identity,
      load: async () => null,
      save: async () => undefined,
    });
    const grid = createGrid<Row>({
      definition: gridDefinition,
      source,
      defaultState: { query: { pagination: offsetQuery(2).pagination }, data: offsetPageData(2) },
      persistence: persistence('tenant-a'),
    });

    expect(() =>
      grid.updateOptions({
        definition: gridDefinition,
        source,
        persistence: persistence('tenant-b'),
      }),
    ).not.toThrow();
    expect(grid.getState().query.pagination).toEqual({ type: 'offset', page: 1, pageSize: 1 });
    expect(grid.getState().data.pageInfo).toBeUndefined();
    grid.destroy();
  });

  it('drops cursor pageInfo while keeping rows until the next cursor result arrives', async () => {
    const pending: Array<ReturnType<typeof deferred<GridReadResult<Row>>>> = [];
    const grid = createGrid<Row>({
      definition: definition(),
      source: createRemoteSource(
        () => {
          const request = deferred<GridReadResult<Row>>();
          pending.push(request);
          return request.promise;
        },
        {
          datasetKey: 'cursor-page-info',
          capabilities: { pagination: 'cursor' },
          policy: { keepPreviousData: true },
        },
      ),
    });

    const initial = grid.start();
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    pending[0]!.resolve({
      rows: [rows[0]!],
      pageInfo: { hasPrevious: false, hasNext: true, nextCursor: 'cursor-2' },
    });
    await initial;

    grid.query.goToCursor('cursor-2', 'forward', 'user');
    expect(grid.getState().data.rows).toEqual([rows[0]]);
    expect(grid.getState().data.pageInfo).toBeUndefined();

    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1]!.resolve({
      rows: [rows[1]!],
      pageInfo: { hasPrevious: true, previousCursor: 'cursor-1', hasNext: false },
    });
    await vi.waitFor(() => expect(grid.getState().data.rows).toEqual([rows[1]]));
    expect(grid.getState().data.pageInfo).toEqual({
      hasPrevious: true,
      previousCursor: 'cursor-1',
      hasNext: false,
    });
    grid.destroy();
  });

  it('keeps pageInfo when a stable dataset replaces its reader without changing the request', () => {
    const gridDefinition = definition();
    const source = (read: () => Promise<GridReadResult<Row>>) =>
      createRemoteSource(read, { datasetKey: 'stable-reader' });
    const grid = createGrid<Row>({
      definition: gridDefinition,
      source: source(async () => ({ rows: [] })),
      defaultState: { data: offsetPageData(1) },
    });
    const pageInfo = grid.getState().data.pageInfo;

    grid.updateOptions({
      definition: gridDefinition,
      source: source(async () => ({ rows: rows.slice(0, 1) })),
    });

    expect(grid.getState().data.pageInfo).toBe(pageInfo);
    grid.destroy();
  });

  it('preserves caller-owned data when controlled query and data advance atomically', () => {
    const gridDefinition = definition();
    const source = createRemoteSource<Row>(async () => ({ rows: [] }), {
      datasetKey: 'atomic-controlled-state',
    });
    const firstData = controlledOffsetPageData(1);
    const grid = createGrid<Row>({
      definition: gridDefinition,
      source,
      state: { query: offsetQuery(1), data: firstData },
      stateDatasetKey: 'atomic-controlled-state',
    });
    const secondData = controlledOffsetPageData(2);

    grid.updateOptions({
      definition: gridDefinition,
      source,
      state: { query: offsetQuery(2), data: secondData },
      stateDatasetKey: 'atomic-controlled-state',
    });

    expect(grid.getState().data).toBe(secondData);
    expect(grid.getState().data.pageInfo).toEqual({ hasPrevious: true, hasNext: true });
    grid.destroy();
  });

  it('keeps effective pageInfo valid when persistence restores behind a controlled query', async () => {
    const columns: GridColumnState = {
      order: ['name'],
      hidden: [],
      widths: { name: 160 },
      pinned: { name: null },
      density: 'compact',
    };
    const timestamp = '2026-01-01T00:00:00.000Z';
    const persisted: GridPersistedState = {
      protocol: 'huiyun.data-grid/preferences/v1',
      gridId: 'store-test',
      revision: 1,
      columns,
      views: [
        {
          id: 'persisted-view',
          name: 'Persisted view',
          query: {
            keyword: 'persisted',
            filters: { id: 'root', type: 'group', logic: 'and', children: [] },
            sorts: [],
          },
          columns,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      activeViewId: 'persisted-view',
      updatedAt: timestamp,
    };
    const controlledQuery = offsetQuery(2);
    const grid = createGrid<Row>({
      definition: definition(),
      source: createControlledSource({
        datasetKey: 'controlled-persistence',
        resultDatasetKey: 'controlled-persistence',
        result: offsetPageData(2),
      }),
      state: { query: controlledQuery },
      stateDatasetKey: 'controlled-persistence',
      defaultState: { data: offsetPageData(2) },
      persistence: {
        identity: 'controlled-persistence',
        load: async () => persisted,
        save: async () => undefined,
      },
    });

    await expect(grid.start()).resolves.toBeUndefined();
    expect(grid.getState().query).toBe(controlledQuery);
    expect(grid.getState().query.pagination).toEqual({ type: 'offset', page: 2, pageSize: 1 });
    expect(grid.getState().data.pageInfo).toEqual({ hasPrevious: true, hasNext: true });
    grid.destroy();
  });

  it('reuses a fresh bounded remote cache by semantic request signature', async () => {
    const read = vi.fn(async ({ request }: { request: { keyword?: string } }) => ({
      rows: [{ id: 1, name: request.keyword || 'Initial' }],
      total: { value: 1, accuracy: 'exact' as const },
    }));
    const grid = createGrid<Row>({
      definition: definition(),
      source: createRemoteSource(read, {
        policy: { cacheTime: 60_000, staleTime: 60_000, maxCacheEntries: 2 },
      }),
    });
    await grid.start();
    grid.query.setKeyword('other');
    await vi.waitFor(() => expect(grid.getState().data.rows[0]?.name).toBe('other'));
    expect(read).toHaveBeenCalledTimes(2);

    grid.query.setKeyword('');
    await vi.waitFor(() => expect(grid.getState().data.rows[0]?.name).toBe('Initial'));
    expect(read).toHaveBeenCalledTimes(2);
    grid.destroy();
  });

  it('resumes with a new read after a pending request was stopped', async () => {
    const requests: Array<ReturnType<typeof deferred<GridReadResult<Row>>>> = [];
    const read = vi.fn(() => {
      const request = deferred<GridReadResult<Row>>();
      requests.push(request);
      return request.promise;
    });
    const grid = createGrid<Row>({
      definition: definition(),
      source: createRemoteSource(read),
    });

    const firstStart = grid.start();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    grid.stop();
    const secondStart = grid.start();
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    requests[0]!.resolve({ rows: [{ id: 1, name: 'Stale' }] });
    requests[1]!.resolve({ rows: [{ id: 2, name: 'Resumed' }] });
    await Promise.all([firstStart, secondStart]);
    expect(grid.getState().data.rows[0]?.name).toBe('Resumed');
    grid.destroy();
  });

  it('does not reload for semantically identical inline source options', async () => {
    const read = vi.fn(async () => ({ rows, total: { value: rows.length } }));
    const grid = createGrid<Row>({
      definition: definition(),
      source: createRemoteSource(read, {
        capabilities: { filter: { logic: 'nested', negation: true }, sort: { max: 3 } },
        policy: { cacheTime: 1_000 },
      }),
    });
    await grid.start();
    grid.updateOptions({
      definition: definition(),
      source: createRemoteSource(read, {
        capabilities: { filter: { logic: 'nested', negation: true }, sort: { max: 3 } },
        policy: { cacheTime: 1_000 },
      }),
    });
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(1);
    grid.destroy();
  });

  it('emits desired state while keeping a controlled query authoritative', () => {
    const query: GridQuery = {
      pagination: { type: 'offset', page: 1, pageSize: 1 },
      keyword: '',
      filters: { id: 'root', type: 'group', logic: 'and', children: [] },
      sorts: [],
    };
    let desired: GridState<Row> | undefined;
    const grid = createGrid<Row>({
      definition: definition(),
      source: createLocalSource(rows),
      state: { query },
      onStateChange: (state) => {
        desired = state;
      },
    });

    grid.query.setKeyword('accepted-later');
    expect(grid.getState().query.keyword).toBe('');
    expect(desired?.query.keyword).toBe('accepted-later');

    const acceptedQuery = desired!.query;
    grid.updateOptions({
      definition: definition(),
      source: createLocalSource(rows),
      state: { query: acceptedQuery },
    });
    expect(grid.getState().query.keyword).toBe('accepted-later');
    grid.destroy();
  });

  it('does not echo an accepted controlled query back to a controlled source', async () => {
    const query: GridQuery = {
      pagination: { type: 'offset', page: 1, pageSize: 1 },
      keyword: '',
      filters: { id: 'root', type: 'group', logic: 'and', children: [] },
      sorts: [],
    };
    const result = { rows: [rows[0]!] };
    const onQueryChange = vi.fn();
    let desired: GridState<Row> | undefined;
    const grid = createGrid<Row>({
      definition: definition(),
      source: createControlledSource({ result, onQueryChange }),
      state: { query },
      onStateChange: (state) => {
        desired = state;
      },
    });
    await grid.start();
    onQueryChange.mockClear();

    grid.query.setKeyword('once');
    expect(onQueryChange).toHaveBeenCalledTimes(1);
    expect(onQueryChange.mock.calls[0]?.[0].keyword).toBe('once');

    grid.updateOptions({
      definition: definition(),
      source: createControlledSource({ result, onQueryChange }),
      state: { query: desired!.query },
      onStateChange: (state) => {
        desired = state;
      },
    });
    expect(grid.getState().query.keyword).toBe('once');
    expect(onQueryChange).toHaveBeenCalledTimes(1);
    grid.destroy();
  });

  it('cancels option consumers independently and aborts the provider when all cancel', async () => {
    const firstRequest = deferred<Array<{ label: string; value: string }>>();
    const secondRequest = deferred<Array<{ label: string; value: string }>>();
    const providerSignals: AbortSignal[] = [];
    const loader = vi.fn(({ search, signal }: { search: string; signal: AbortSignal }) => {
      providerSignals.push(signal);
      return search === 'first' ? firstRequest.promise : secondRequest.promise;
    });
    const grid = createGrid<Row>({
      definition: definition({
        fields: [
          {
            id: 'name',
            title: 'Name',
            options: { load: loader },
          },
        ],
      }),
      source: createLocalSource(rows),
    });

    const firstConsumer = new AbortController();
    const secondConsumer = new AbortController();
    const first = grid.options.load('name', 'first', { signal: firstConsumer.signal });
    const shared = grid.options.load('name', 'first', { signal: secondConsumer.signal });
    expect(loader).toHaveBeenCalledTimes(1);
    firstConsumer.abort();
    await expect(first).resolves.toEqual([]);
    expect(providerSignals[0]?.aborted).toBe(false);
    firstRequest.resolve([{ label: 'One', value: 'one' }]);
    await expect(shared).resolves.toEqual([{ label: 'One', value: 'one' }]);

    const thirdConsumer = new AbortController();
    const fourthConsumer = new AbortController();
    const third = grid.options.load('name', 'second', { signal: thirdConsumer.signal });
    const fourth = grid.options.load('name', 'second', { signal: fourthConsumer.signal });
    expect(loader).toHaveBeenCalledTimes(2);
    thirdConsumer.abort();
    expect(providerSignals[1]?.aborted).toBe(false);
    fourthConsumer.abort();
    await expect(Promise.all([third, fourth])).resolves.toEqual([[], []]);
    expect(providerSignals[1]?.aborted).toBe(true);
    grid.destroy();
  });

  it('searches facet-backed options locally when no option provider is declared', async () => {
    const grid = createGrid<Row>({
      definition: definition(),
      source: createLocalSource(rows),
      defaultState: {
        data: {
          facets: {
            name: [
              { label: 'Alpha', value: 'alpha' },
              { label: 'Beta', value: 'beta' },
            ],
          },
        },
      },
    });
    await expect(grid.options.load('name', 'alp')).resolves.toEqual([
      { label: 'Alpha', value: 'alpha' },
    ]);
    grid.destroy();
  });

  it('tracks view dirtiness and persists user preferences', async () => {
    vi.useFakeTimers();
    const save = vi.fn<GridPersistence<Row>['save']>(async () => undefined);
    const persistence: GridPersistence<Row> = {
      load: async () => null,
      save,
    };
    const grid = createGrid<Row>({
      definition: definition(),
      source: createLocalSource(rows),
      persistence,
    });
    await grid.start();
    const view = grid.views.create('Important');
    expect(view).toBeDefined();
    expect(grid.getState().views.dirty).toBe(false);

    grid.query.setKeyword('changed');
    expect(grid.getState().views.dirty).toBe(true);
    grid.views.save(view!.id);
    expect(grid.getState().views.dirty).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalled();
    expect(save.mock.calls.at(-1)?.[1].views[0]?.name).toBe('Important');
    grid.destroy();
    vi.useRealTimers();
  });

  it('centralizes editing and action pending/error state', async () => {
    const editRequest = deferred<Row>();
    const actionRequest = deferred<void>();
    const grid = createGrid<Row>({
      definition: definition({
        editing: {
          reloadOnSave: false,
          save: () => editRequest.promise,
        },
        actions: [
          {
            id: 'archive',
            label: 'Archive',
            placement: 'row',
            run: () => actionRequest.promise,
          },
        ],
      }),
      source: createLocalSource(rows),
    });
    await grid.start();

    grid.editing.begin(rows[0]!, 'name');
    grid.editing.setDraft('Edited');
    const editing = grid.editing.commit();
    expect(grid.getState().editing.saving).toBe(true);
    editRequest.resolve({ id: 1, name: 'Edited' });
    await expect(editing).resolves.toBe(true);
    expect(grid.getState().data.rows[0]?.name).toBe('Edited');

    const action = grid.actions.run('archive', { row: rows[0] });
    const actionKey = grid.actions.key('archive', rows[0]);
    expect(grid.getState().actions.pending[actionKey]).toBe(true);
    actionRequest.resolve();
    await action;
    expect(grid.getState().actions.pending[actionKey]).toBe(false);
    grid.destroy();
  });

  it('rolls back an optimistic edit when the transaction is cancelled', async () => {
    const editRequest = deferred<void>();
    const grid = createGrid<Row>({
      definition: definition({
        editing: {
          optimistic: true,
          reloadOnSave: false,
          apply: (row, field, value) => ({ ...row, [field.id]: value }),
          save: () => editRequest.promise,
        },
      }),
      source: createLocalSource(rows),
    });
    await grid.start();
    grid.editing.begin(rows[0]!, 'name');
    grid.editing.setDraft('Optimistic');
    const saving = grid.editing.commit();
    await Promise.resolve();
    expect(grid.getState().data.rows[0]?.name).toBe('Optimistic');

    grid.editing.cancel();
    expect(grid.getState().data.rows[0]?.name).toBe('One');
    editRequest.resolve();
    await expect(saving).resolves.toBe(false);
    grid.destroy();
  });

  it('settles and ignores a remote read when the logical dataset changes', async () => {
    const request = deferred<GridReadResult<Row>>();
    let signal: AbortSignal | undefined;
    const read = vi.fn((input: { signal: AbortSignal }) => {
      signal = input.signal;
      return request.promise;
    });
    const grid = createGrid<Row>({
      definition: definition(),
      source: createRemoteSource(read, { datasetKey: 'tenant-a' }),
    });

    const starting = grid.start();
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    grid.updateOptions({
      definition: definition(),
      source: createControlledSource({
        datasetKey: 'tenant-b',
        resultDatasetKey: 'tenant-b',
        result: { rows: [{ id: 2, name: 'Tenant B' }], total: { value: 1 } },
      }),
    });

    await expect(starting).resolves.toBeUndefined();
    expect(signal?.aborted).toBe(true);
    expect(grid.getState().data.rows[0]?.name).toBe('Tenant B');
    request.resolve({ rows: [{ id: 1, name: 'Late tenant A' }] });
    await Promise.resolve();
    expect(grid.getState().data.rows[0]?.name).toBe('Tenant B');
    grid.destroy();
  });

  it('aborts edit, action and option work at a dataset boundary', async () => {
    const editRequest = deferred<void>();
    const actionRequest = deferred<void>();
    const optionRequest = deferred<Array<{ label: string; value: string }>>();
    let editSignal: AbortSignal | undefined;
    let actionSignal: AbortSignal | undefined;
    let optionSignal: AbortSignal | undefined;
    const gridDefinition = definition({
      fields: [
        {
          id: 'name',
          title: 'Name',
          edit: true,
          options: {
            load: ({ signal }) => {
              optionSignal = signal;
              return optionRequest.promise;
            },
          },
        },
      ],
      editing: {
        reloadOnSave: false,
        save: ({ signal }) => {
          editSignal = signal;
          return editRequest.promise;
        },
      },
      actions: [
        {
          id: 'archive',
          label: 'Archive',
          placement: 'row',
          run: ({ signal }) => {
            actionSignal = signal;
            return actionRequest.promise;
          },
        },
      ],
    });
    const grid = createGrid<Row>({
      definition: gridDefinition,
      source: createLocalSource(rows, undefined, 'tenant-a'),
    });
    await grid.start();

    grid.editing.begin(rows[0]!, 'name');
    grid.editing.setDraft('Pending');
    const editing = grid.editing.commit();
    const actionKey = grid.actions.key('archive', rows[0]);
    const action = grid.actions.run('archive', { row: rows[0] });
    const options = grid.options.load('name');
    expect(grid.getState().editing.saving).toBe(true);
    expect(grid.getState().actions.pending[actionKey]).toBe(true);

    grid.updateOptions({
      definition: gridDefinition,
      source: createLocalSource([{ id: 20, name: 'Tenant B' }], undefined, 'tenant-b'),
    });

    expect(editSignal?.aborted).toBe(true);
    expect(actionSignal?.aborted).toBe(true);
    expect(optionSignal?.aborted).toBe(true);
    await expect(editing).resolves.toBe(false);
    await expect(action).resolves.toBeUndefined();
    await expect(options).resolves.toEqual([]);
    expect(grid.getState().editing.saving).toBe(false);
    expect(grid.getState().actions.pending[actionKey]).toBe(false);
    expect(grid.getState().data.rows[0]?.name).toBe('Tenant B');
    grid.destroy();
  });

  it('emits desired projection for controlled columns and controlled data', async () => {
    const controlledColumns: GridColumnState = {
      order: ['id', 'name'],
      hidden: [],
      widths: { id: 160, name: 160 },
      pinned: { id: null, name: null },
      density: 'compact',
    };
    const gridDefinition = definition({
      fields: [
        { id: 'id', title: 'ID' },
        { id: 'name', title: 'Name' },
      ],
    });
    const result = { rows: [rows[0]!], total: { value: 1 } };
    const onQueryChange = vi.fn();
    const source = createControlledSource({
      datasetKey: 'controlled',
      resultDatasetKey: 'controlled',
      result,
      capabilities: { projection: true },
      onQueryChange,
    });
    const grid = createGrid<Row>({
      definition: gridDefinition,
      source,
      state: { columns: controlledColumns },
    });
    await grid.start();
    onQueryChange.mockClear();

    grid.columns.setVisible('name', false);
    expect(grid.getState().columns.hidden).toEqual([]);
    expect(onQueryChange).toHaveBeenCalledOnce();
    expect(onQueryChange.mock.calls[0]?.[1].select).toEqual(['id']);

    grid.updateOptions({
      definition: gridDefinition,
      source,
      state: { columns: { ...controlledColumns, hidden: ['name'] } },
    });
    expect(grid.getState().columns.hidden).toEqual(['name']);
    expect(onQueryChange).toHaveBeenCalledOnce();
    grid.destroy();
  });

  it('refreshes selected entities and reconciles all-matching totals', async () => {
    const gridDefinition = definition();
    const source = (result: GridReadResult<Row>) =>
      createControlledSource({
        datasetKey: 'selection',
        resultDatasetKey: 'selection',
        result,
        capabilities: { selectAllMatching: true },
      });
    const grid = createGrid<Row>({
      definition: gridDefinition,
      source: source({
        rows: [rows[0]!],
        total: { value: 3 },
        snapshotId: 'selection-snapshot',
      }),
    });
    await grid.start();
    grid.selection.selectPage();

    grid.updateOptions({
      definition: gridDefinition,
      source: source({
        rows: [rows[1]!],
        total: { value: 3 },
        snapshotId: 'selection-snapshot',
      }),
    });
    expect(grid.selection.getSelectedRows()[0]?.name).toBe('One');

    grid.updateOptions({
      definition: gridDefinition,
      source: source({
        rows: [{ id: 1, name: 'One refreshed' }],
        total: { value: 3 },
        snapshotId: 'selection-snapshot',
      }),
    });
    expect(grid.selection.getSelectedRows()[0]?.name).toBe('One refreshed');

    grid.selection.selectAllMatching();
    expect(grid.getState().selection).toMatchObject({ snapshotId: 'selection-snapshot' });
    grid.selection.toggle(1, { id: 1, name: 'One refreshed' }, false);
    grid.updateOptions({
      definition: gridDefinition,
      source: source({
        rows: [rows[1]!],
        total: { value: 5 },
        snapshotId: 'selection-snapshot',
      }),
    });
    expect(grid.getState().selection).toMatchObject({
      mode: 'allMatching',
      snapshotId: 'selection-snapshot',
      total: 5,
      excludedKeys: [1],
    });
    expect(grid.selection.getCount()).toBe(4);

    grid.updateOptions({
      definition: gridDefinition,
      source: source({
        rows: [rows[1]!],
        total: { value: 6 },
        snapshotId: 'next-snapshot',
      }),
    });
    expect(grid.getState().selection).toEqual({ mode: 'explicit', selectedKeys: [] });
    expect(grid.selection.getCount()).toBe(0);
    grid.destroy();
  });

  it('uses tuple option cache keys, clears exact fields and rejects malformed options', async () => {
    const loadA = vi.fn(async () => [{ label: 'A', value: 'a' }]);
    const loadAB = vi.fn(async () => [{ label: 'AB', value: 'ab' }]);
    const grid = createGrid<Row>({
      definition: definition({
        fields: [
          { id: 'a', title: 'A', options: { load: loadA } },
          { id: 'a:b', title: 'AB', options: { load: loadAB } },
          {
            id: 'bad',
            title: 'Bad',
            options: { load: async () => [{ label: 'Bad', value: {} }] as never },
          },
        ],
      }),
      source: createLocalSource(rows),
    });

    await expect(grid.options.load('a:b', 'c')).resolves.toEqual([{ label: 'AB', value: 'ab' }]);
    await expect(grid.options.load('a', 'b:c')).resolves.toEqual([{ label: 'A', value: 'a' }]);
    grid.options.clear('a');
    await expect(grid.options.load('a:b', 'c')).resolves.toEqual([{ label: 'AB', value: 'ab' }]);
    expect(loadAB).toHaveBeenCalledOnce();
    await expect(grid.options.load('bad')).rejects.toThrow('invalid value');
    grid.destroy();
  });

  it('creates collision-proof action keys and canonicalizes React-equivalent row keys', () => {
    interface KeyRow {
      id: string | number;
      name: string;
    }
    const grid = createGrid<KeyRow>({
      definition: {
        id: 'action-key-test',
        rowKey: 'id',
        fields: [{ id: 'name', title: 'Name' }],
      },
      source: createLocalSource([]),
    });
    expect(grid.actions.key('a:b', { id: 'c', name: '' })).not.toBe(
      grid.actions.key('a', { id: 'b:c', name: '' }),
    );
    expect(grid.actions.key('a', { id: 1, name: '' })).toBe(
      grid.actions.key('a', { id: '1', name: '' }),
    );
    grid.destroy();
  });

  it('restores the active persisted view query and ignores a superseded late hydrate', async () => {
    const columns: GridColumnState = {
      order: ['name'],
      hidden: [],
      widths: { name: 160 },
      pinned: { name: null },
      density: 'compact',
    };
    const persisted = (keyword: string): GridPersistedState => ({
      protocol: 'huiyun.data-grid/preferences/v1',
      gridId: 'store-test',
      revision: 1,
      columns,
      views: [
        {
          id: 'active',
          name: 'Active',
          scope: 'private',
          query: {
            keyword,
            filters: { id: 'root', type: 'group', logic: 'and', children: [] },
            sorts: [],
          },
          columns,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      activeViewId: 'active',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const oldLoad = deferred<GridPersistedState | null>();
    const oldPersistence: GridPersistence<Row> = {
      identity: 'old-user',
      load: () => oldLoad.promise,
      save: async () => undefined,
    };
    const newPersistence: GridPersistence<Row> = {
      identity: 'new-user',
      load: async () => persisted('Two'),
      save: async () => undefined,
    };
    const grid = createGrid<Row>({
      definition: definition(),
      source: createLocalSource(rows),
      persistence: oldPersistence,
    });

    const starting = grid.start();
    grid.updateOptions({
      definition: definition(),
      source: createLocalSource(rows),
      persistence: newPersistence,
    });
    await vi.waitFor(() => expect(grid.getState().query.keyword).toBe('Two'));
    expect(grid.getState().views.activeId).toBe('active');

    oldLoad.resolve(persisted('One'));
    await starting;
    expect(grid.getState().query.keyword).toBe('Two');
    expect(grid.getState().data.rows[0]?.name).toBe('Two');
    grid.destroy();
  });

  it('returns to the construction preference baseline when persistence identity changes to empty', async () => {
    const columns: GridColumnState = {
      order: ['name'],
      hidden: [],
      widths: { name: 160 },
      pinned: { name: null },
      density: 'compact',
    };
    const activeView = {
      id: 'tenant-a-view',
      name: 'Tenant A',
      query: {
        keyword: 'tenant-a',
        filters: { id: 'root', type: 'group' as const, logic: 'and' as const, children: [] },
        sorts: [],
      },
      columns,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const tenantA: GridPersistedState = {
      protocol: 'huiyun.data-grid/preferences/v1',
      gridId: 'store-test',
      revision: 1,
      columns,
      views: [activeView],
      activeViewId: activeView.id,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const gridDefinition = definition();
    const source = createLocalSource(rows);
    const grid = createGrid<Row>({
      definition: gridDefinition,
      source,
      defaultState: {
        query: { keyword: 'baseline' },
        columns: { density: 'comfortable' },
      },
      persistence: {
        identity: 'tenant-a',
        load: async () => tenantA,
        save: async () => undefined,
      },
    });
    await grid.start();
    expect(grid.getState().query.keyword).toBe('tenant-a');
    expect(grid.getState().views.activeId).toBe(activeView.id);

    grid.updateOptions({
      definition: gridDefinition,
      source,
      persistence: {
        identity: 'tenant-b',
        load: async () => null,
        save: async () => undefined,
      },
    });
    expect(grid.getState().query.keyword).toBe('baseline');
    expect(grid.getState().columns.density).toBe('comfortable');
    expect(grid.getState().views).toEqual({ activeId: undefined, items: [], dirty: false });
    grid.destroy();
  });

  it('serializes preference saves so an older async write cannot win', async () => {
    vi.useFakeTimers();
    try {
      const requests: Array<ReturnType<typeof deferred<void>>> = [];
      const snapshots: GridPersistedState[] = [];
      const save = vi.fn<GridPersistence<Row>['save']>(async (_id, state) => {
        snapshots.push(state);
        const request = deferred<void>();
        requests.push(request);
        return request.promise;
      });
      const grid = createGrid<Row>({
        definition: definition(),
        source: createLocalSource(rows),
        persistence: { identity: 'save-order', load: async () => null, save },
      });
      await grid.start();
      const view = grid.views.create('First')!;
      await vi.advanceTimersByTimeAsync(300);
      expect(save).toHaveBeenCalledTimes(1);

      grid.views.rename(view.id, 'Second');
      await vi.advanceTimersByTimeAsync(300);
      expect(save).toHaveBeenCalledTimes(1);
      requests[0]!.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(save).toHaveBeenCalledTimes(2);
      expect(snapshots.map((state) => state.views[0]?.name)).toEqual(['First', 'Second']);
      requests[1]!.resolve();
      await vi.advanceTimersByTimeAsync(0);
      grid.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes normalized and encoded edit values and rolls back optimistically with CAS', async () => {
    const saveRequest = deferred<void>();
    const save = vi.fn(() => saveRequest.promise);
    const gridDefinition = definition({
      fields: [
        {
          id: 'name',
          title: 'Name',
          edit: true,
          normalize: (value) => String(value).trim(),
          transport: { encodeValue: (value) => `wire:${String(value)}` },
        },
      ],
      editing: {
        optimistic: true,
        reloadOnSave: false,
        apply: (row, field, value) => ({ ...row, [field.id]: value }),
        save,
      },
    });
    const grid = createGrid<Row>({
      definition: gridDefinition,
      source: createLocalSource(rows),
    });
    await grid.start();
    grid.editing.begin(rows[0]!, 'name');
    grid.editing.setDraft('  Client  ');
    const saving = grid.editing.commit();
    expect(grid.getState().data.rows[0]?.name).toBe('Client');
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'Client', encodedValue: 'wire:Client' }),
    );

    grid.updateOptions({
      definition: gridDefinition,
      source: createLocalSource([{ id: 1, name: 'Server' }, ...rows.slice(1)]),
    });
    expect(grid.getState().data.rows[0]?.name).toBe('Server');
    grid.editing.cancel();
    expect(grid.getState().data.rows[0]?.name).toBe('Server');
    await expect(saving).resolves.toBe(false);
    grid.destroy();
  });

  it('rejects non-JSON edit encodings before calling save', async () => {
    const save = vi.fn(async () => undefined);
    const grid = createGrid<Row>({
      definition: definition({
        fields: [
          {
            id: 'name',
            title: 'Name',
            edit: true,
            transport: { encodeValue: () => new Date() as never },
          },
        ],
        editing: { reloadOnSave: false, save },
      }),
      source: createLocalSource(rows),
    });
    await grid.start();
    grid.editing.begin(rows[0]!, 'name');
    grid.editing.setDraft('Invalid wire value');
    await expect(grid.editing.commit()).resolves.toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(grid.getState().editing.error).toContain('JSON-safe');
    grid.destroy();
  });

  it('checks required and validation rules after normalizing the edit draft', async () => {
    let validationError: string | undefined = 'Rejected after normalize';
    const save = vi.fn(async () => undefined);
    const grid = createGrid<Row>({
      definition: definition({
        fields: [
          {
            id: 'name',
            title: 'Name',
            edit: { required: true },
            normalize: (value) => String(value).trim(),
            validate: () => validationError,
          },
        ],
        editing: { reloadOnSave: false, save },
      }),
      source: createLocalSource(rows),
    });
    await grid.start();
    grid.editing.begin(rows[0]!, 'name');
    grid.editing.setDraft('   ');
    await expect(grid.editing.commit()).resolves.toBe(false);
    expect(grid.getState().editing.errorCode).toBe('required');

    grid.editing.setDraft('  Valid shape  ');
    await expect(grid.editing.commit()).resolves.toBe(false);
    expect(grid.getState().editing.error).toBe('Rejected after normalize');
    validationError = undefined;
    await expect(grid.editing.commit()).resolves.toBe(true);
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ value: 'Valid shape' }));
    grid.destroy();
  });

  it('rejects row replacements and edit results that change the target row key', async () => {
    const grid = createGrid<Row>({
      definition: definition({
        editing: {
          reloadOnSave: false,
          save: async () => ({ id: 2, name: 'Wrong entity' }),
        },
      }),
      source: createLocalSource(rows),
    });
    await grid.start();
    expect(() => grid.data.updateRow(1, { id: 2, name: 'Wrong entity' })).toThrow(
      'does not match target key',
    );
    grid.editing.begin(rows[0]!, 'name');
    grid.editing.setDraft('Changed');
    await expect(grid.editing.commit()).resolves.toBe(false);
    expect(grid.getState().data.rows[0]).toEqual(rows[0]);
    expect(grid.getState().editing.error).toContain('does not match target key');
    grid.destroy();
  });

  it('requires optimistic apply to return a new row object', async () => {
    const save = vi.fn(async () => undefined);
    const grid = createGrid<Row>({
      definition: definition({
        editing: {
          optimistic: true,
          reloadOnSave: false,
          apply: (row) => row,
          save,
        },
      }),
      source: createLocalSource(rows),
    });
    await grid.start();
    grid.editing.begin(rows[0]!, 'name');
    grid.editing.setDraft('Changed');
    await expect(grid.editing.commit()).resolves.toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(grid.getState().editing.error).toContain('must return a new row object');
    expect(grid.getState().data.rows[0]).toEqual(rows[0]);
    grid.destroy();
  });

  it('rejects remote or controlled rows whose typed keys collide in React', async () => {
    interface KeyRow {
      id: string | number;
      name: string;
    }
    const onError = vi.fn();
    const grid = createGrid<KeyRow>({
      definition: {
        id: 'typed-key-collision',
        rowKey: 'id',
        fields: [{ id: 'name', title: 'Name' }],
        defaults: { pageSize: 2 },
      },
      source: createControlledSource({
        result: {
          rows: [
            { id: 1, name: 'Number' },
            { id: '1', name: 'String' },
          ],
        },
      }),
      onError,
    });
    await grid.start();
    expect(grid.getState().data.status).toBe('error');
    expect(grid.getState().data.error?.message).toContain('Duplicate row key');
    expect(onError).toHaveBeenCalled();
    grid.destroy();
  });

  it('runtime-validates custom persistence adapter payloads before hydration', async () => {
    const onError = vi.fn();
    const grid = createGrid<Row>({
      definition: definition(),
      source: createLocalSource(rows),
      persistence: {
        load: async () =>
          ({
            protocol: 'huiyun.data-grid/preferences/v1',
            gridId: 'store-test',
            revision: 1,
            columns: {
              order: ['name'],
              hidden: [],
              widths: { name: 160 },
              pinned: { name: null },
              density: 'compact',
            },
            views: [{ id: 'malformed' }],
            updatedAt: '2026-01-01T00:00:00.000Z',
          }) as never,
        save: async () => undefined,
      },
      onError,
    });
    await grid.start();
    expect(grid.getState().views.items).toEqual([]);
    expect(onError.mock.calls[0]?.[0].message).toContain('do not match');
    grid.destroy();
  });

  it('hot-swaps runtime callbacks at one revision but rejects structural drift', async () => {
    const source = createLocalSource(rows);
    const firstRun = vi.fn(async () => undefined);
    const secondRun = vi.fn(async () => undefined);
    const withRun = (run: () => Promise<void>) =>
      definition({
        actions: [{ id: 'refresh', label: 'Refresh', placement: 'toolbar', run }],
      });
    const grid = createGrid<Row>({ definition: withRun(firstRun), source });
    await grid.start();

    grid.updateOptions({ definition: withRun(secondRun), source });
    await grid.actions.run('refresh');
    expect(firstRun).not.toHaveBeenCalled();
    expect(secondRun).toHaveBeenCalledOnce();

    expect(() =>
      grid.updateOptions({
        definition: definition({
          fields: [{ id: 'name', title: 'Name', filter: true, sort: false, edit: true }],
          actions: [{ id: 'refresh', label: 'Refresh', placement: 'toolbar', run: secondRun }],
        }),
        source,
      }),
    ).toThrow('requires a new definition revision');
    grid.destroy();
  });

  it('resets pagination protocol on source mode changes and blocks post-destroy callbacks', async () => {
    const onStateChange = vi.fn();
    const onQueryChange = vi.fn();
    const grid = createGrid<Row>({
      definition: definition(),
      source: createLocalSource(rows),
      onStateChange,
    });
    await grid.start();
    grid.query.setPage(3);
    grid.updateOptions({
      definition: definition(),
      source: createRemoteSource<Row>(async () => ({ rows: [] }), {
        datasetKey: 'cursor-source',
        capabilities: { pagination: 'cursor' },
      }),
      onStateChange,
    });
    expect(grid.getState().query.pagination).toEqual({ type: 'cursor', pageSize: 1 });
    grid.query.reset();
    expect(grid.getState().query.pagination).toEqual({ type: 'cursor', pageSize: 1 });

    grid.updateOptions({
      definition: definition(),
      source: createControlledSource({
        datasetKey: 'controlled-after-cursor',
        resultDatasetKey: 'controlled-after-cursor',
        result: { rows: [] },
        capabilities: { pagination: 'cursor' },
        onQueryChange,
      }),
      onStateChange,
    });
    onQueryChange.mockClear();
    grid.destroy();
    grid.query.setKeyword('after destroy');
    expect(onQueryChange).not.toHaveBeenCalled();

    const batchedStateChange = vi.fn();
    const batched = createGrid<Row>({
      definition: definition(),
      source: createLocalSource(rows),
      onStateChange: batchedStateChange,
    });
    batched.batch(() => {
      batched.query.setKeyword('queued');
      batched.destroy();
    });
    expect(batchedStateChange).not.toHaveBeenCalled();
  });

  it('validates temporal options transactionally before committing new options', async () => {
    const grid = createGrid<Row>({
      definition: definition(),
      source: createLocalSource(rows),
      temporal: { timeZone: 'UTC' },
    });
    await grid.start();
    expect(() =>
      grid.updateOptions({
        definition: definition(),
        source: createLocalSource([{ id: 9, name: 'Should not commit' }], undefined, 'new'),
        temporal: { timeZone: 'Not/A-Time-Zone' },
      }),
    ).toThrow('timeZone');
    await grid.data.reload();
    expect(grid.getState().data.rows[0]?.name).toBe('One');
    grid.destroy();
  });

  it('rejects a source capability contraction that would silently change the query', async () => {
    const gridDefinition = definition({
      fields: [
        { id: 'id', title: 'ID', filter: true, sort: true },
        { id: 'name', title: 'Name', filter: true, sort: true },
      ],
    });
    const query: GridQuery = {
      pagination: { type: 'offset', page: 1, pageSize: 1 },
      keyword: 'One',
      filters: {
        id: 'root',
        type: 'group',
        logic: 'or',
        negated: true,
        children: [
          {
            id: 'name-filter',
            type: 'condition',
            fieldId: 'name',
            operator: 'contains',
            value: 'O',
          },
          {
            id: 'nested',
            type: 'group',
            logic: 'and',
            children: [
              { id: 'id-filter', type: 'condition', fieldId: 'id', operator: 'equals', value: 1 },
            ],
          },
        ],
      },
      sorts: [
        { id: 'name-sort', fieldId: 'name', direction: 'asc', nulls: 'last' },
        { id: 'id-sort', fieldId: 'id', direction: 'desc' },
      ],
    };
    const grid = createGrid<Row>({
      definition: gridDefinition,
      source: createLocalSource(rows),
      state: { query },
    });
    await grid.start();
    const before = grid.getState();
    expect(() =>
      grid.updateOptions({
        definition: gridDefinition,
        source: createRemoteSource<Row>(async () => ({ rows: [] }), {
          capabilities: {
            search: false,
            filter: {
              logic: 'and',
              negation: false,
              maxDepth: 1,
              maxConditions: 1,
              operators: ['equals'],
            },
            sort: { max: 1, nulls: false },
          },
        }),
        state: { query },
      }),
    ).toThrow('conflicts with the current grid source capabilities');
    expect(grid.getState()).toBe(before);
    expect(grid.capabilities.search).toBe(true);
    grid.destroy();
  });

  it('rejects an incompatible view transactionally instead of applying a reduced query', async () => {
    const incompatibleView = {
      id: 'requires-search',
      name: 'Requires search',
      query: {
        keyword: 'hidden',
        filters: { id: 'root', type: 'group' as const, logic: 'and' as const, children: [] },
        sorts: [],
      },
      columns: {
        order: ['name'],
        hidden: [],
        widths: { name: 160 },
        pinned: { name: null },
        density: 'compact' as const,
      },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const grid = createGrid<Row>({
      definition: definition(),
      source: createRemoteSource<Row>(async () => ({ rows: [] }), {
        capabilities: { search: false },
      }),
      defaultState: { views: { items: [incompatibleView] } },
    });
    await grid.start();
    const before = grid.getState();
    expect(() => grid.views.apply(incompatibleView.id)).toThrow(
      'conflicts with the current grid source capabilities',
    );
    expect(grid.getState()).toBe(before);
    grid.destroy();
  });

  it('rejects malformed controlled state and public mutation inputs without pollution', async () => {
    const gridDefinition = definition();
    const source = createLocalSource(rows);
    const grid = createGrid<Row>({ definition: gridDefinition, source });
    await grid.start();
    const before = grid.getState();

    expect(() =>
      grid.updateOptions({
        definition: gridDefinition,
        source,
        state: {
          selection: {
            mode: 'allMatching',
            querySignature: '',
            total: -1,
            excludedKeys: [],
          },
        },
      }),
    ).toThrow('selection');
    expect(grid.getState()).toBe(before);
    expect(() => grid.columns.setDensity('invalid' as never)).toThrow('density');
    expect(() => grid.columns.setWidth('name', Number.NaN)).toThrow('finite');
    expect(() => grid.selection.toggle(1, rows[1]!)).toThrow('does not match');
    expect(() => grid.views.create(42 as never)).toThrow('string name');
    expect(grid.getState()).toBe(before);
    grid.destroy();
  });

  it('masks stale controlled data and controlled results across dataset boundaries', async () => {
    const staleResult = { rows: [{ id: 1, name: 'Tenant A' }], total: { value: 1 } };
    const controlled = createGrid<Row>({
      definition: definition(),
      source: createControlledSource({
        datasetKey: 'tenant-a',
        resultDatasetKey: 'tenant-a',
        result: staleResult,
      }),
    });
    await controlled.start();
    controlled.updateOptions({
      definition: definition(),
      source: createControlledSource({
        datasetKey: 'tenant-b',
        resultDatasetKey: 'tenant-a',
        result: staleResult,
      }),
    });
    expect(controlled.getState().data.rows).toEqual([]);
    expect(controlled.getState().data.status).toBe('loading');
    expect(controlled.getState().data.fetching).toBe(true);
    controlled.updateOptions({
      definition: definition(),
      source: createControlledSource({
        datasetKey: 'tenant-b',
        resultDatasetKey: 'tenant-b',
        result: { rows: [{ id: 2, name: 'Tenant B' }], total: { value: 1 } },
      }),
    });
    expect(controlled.getState().data.rows[0]?.name).toBe('Tenant B');
    controlled.destroy();

    const tenantBRead = deferred<GridReadResult<Row>>();
    const tenantCRead = deferred<GridReadResult<Row>>();
    const staleData: GridState<Row>['data'] = {
      status: 'success',
      fetching: false,
      rows: staleResult.rows,
      total: staleResult.total,
      summary: [],
      facets: {},
      warnings: [],
    };
    const firstRead = vi.fn(async () => staleResult);
    const secondRead = vi.fn(() => tenantBRead.promise);
    const thirdRead = vi.fn(() => tenantCRead.promise);
    const stateControlled = createGrid<Row>({
      definition: definition(),
      source: createRemoteSource(firstRead, { datasetKey: 'tenant-a' }),
      state: { data: staleData },
      stateDatasetKey: 'tenant-a',
    });
    await stateControlled.start();
    stateControlled.updateOptions({
      definition: definition(),
      source: createRemoteSource(secondRead, { datasetKey: 'tenant-b' }),
      state: { data: { ...staleData, rows: [...staleData.rows] } },
      stateDatasetKey: 'tenant-a',
    });
    expect(stateControlled.getState().data.rows).toEqual([]);
    expect(stateControlled.getState().data.fetching).toBe(true);
    stateControlled.updateOptions({
      definition: definition(),
      source: createRemoteSource(thirdRead, { datasetKey: 'tenant-c' }),
      state: { data: { ...staleData, rows: [...staleData.rows] } },
      stateDatasetKey: 'tenant-a',
    });
    expect(stateControlled.getState().data.rows).toEqual([]);
    tenantBRead.resolve({ rows: [{ id: 2, name: 'Late Tenant B' }], total: { value: 1 } });
    tenantCRead.resolve({ rows: [{ id: 3, name: 'Tenant C' }], total: { value: 1 } });
    await vi.waitFor(() => expect(stateControlled.getState().data.rows[0]?.name).toBe('Tenant C'));
    stateControlled.destroy();
  });

  it('keeps entity-controlled slices masked until their dataset provenance is acknowledged', async () => {
    const save = vi.fn(async () => undefined);
    const onStateChange = vi.fn();
    const gridDefinition = definition({ editing: { save, reloadOnSave: false } });
    const tenantAState: Partial<GridState<Row>> = {
      selection: { mode: 'explicit', selectedKeys: [1] },
      editing: {
        active: {
          rowKey: 1,
          fieldId: 'name',
          previousValue: 'Tenant A',
          draft: 'Tenant A draft',
        },
        saving: false,
      },
      actions: { pending: { 'tenant-a-action': true }, errors: { 'tenant-a-action': 'old' } },
    };
    const grid = createGrid<Row>({
      definition: gridDefinition,
      source: createControlledSource({
        datasetKey: 'tenant-a',
        resultDatasetKey: 'tenant-a',
        result: { rows: [{ id: 1, name: 'Tenant A' }] },
      }),
      state: tenantAState,
      stateDatasetKey: 'tenant-a',
      onStateChange,
    });
    await grid.start();
    onStateChange.mockClear();

    const updateDataset = (
      datasetKey: string,
      name: string,
      state = tenantAState,
      stateDatasetKey = 'tenant-a',
    ) =>
      grid.updateOptions({
        definition: gridDefinition,
        source: createControlledSource({
          datasetKey,
          resultDatasetKey: datasetKey,
          result: { rows: [{ id: 1, name }] },
        }),
        state,
        stateDatasetKey,
        onStateChange,
      });
    updateDataset('tenant-b', 'Tenant B', {
      selection: { mode: 'explicit', selectedKeys: [1] },
      editing: {
        active: {
          rowKey: 1,
          fieldId: 'name',
          previousValue: 'Tenant A',
          draft: 'Cloned stale draft',
        },
        saving: false,
      },
      actions: { pending: { 'tenant-a-action': true }, errors: {} },
    });
    const resetCalls = onStateChange.mock.calls.filter(
      (call) => call[1]?.type === 'dataset.controlled.reset',
    );
    expect(resetCalls).toHaveLength(1);
    expect(resetCalls[0]?.[0]).toMatchObject({
      selection: { mode: 'explicit', selectedKeys: [] },
      editing: { saving: false },
      actions: { pending: { 'tenant-a-action': false }, errors: {} },
    });
    expect(grid.getState()).toMatchObject({
      selection: { mode: 'explicit', selectedKeys: [] },
      editing: { saving: false },
      actions: { pending: { 'tenant-a-action': false }, errors: {} },
    });
    expect(grid.selection.getSelectedRows()).toEqual([]);

    updateDataset('tenant-c', 'Tenant C');
    expect(grid.getState().selection).toEqual({ mode: 'explicit', selectedKeys: [] });
    expect(grid.getState().editing.active).toBeUndefined();
    expect(grid.getState().actions).toEqual({
      pending: { 'tenant-a-action': false },
      errors: {},
    });

    updateDataset(
      'tenant-c',
      'Tenant C',
      {
        selection: { mode: 'explicit', selectedKeys: [1] },
        editing: {
          active: {
            rowKey: 1,
            fieldId: 'name',
            previousValue: 'Tenant C',
            draft: 'Tenant C acknowledged',
          },
          saving: false,
        },
        actions: { pending: {}, errors: {} },
      },
      'tenant-c',
    );
    expect(grid.getState().selection).toEqual({ mode: 'explicit', selectedKeys: [1] });
    expect(grid.getState().editing.active?.draft).toBe('Tenant C acknowledged');
    grid.destroy();
  });

  it('joins concurrent starts and normalizes loading state when stopped', async () => {
    const request = deferred<GridReadResult<Row>>();
    const grid = createGrid<Row>({
      definition: definition(),
      source: createRemoteSource(() => request.promise),
    });
    const first = grid.start();
    const second = grid.start();
    expect(second).toBe(first);
    await vi.waitFor(() => expect(grid.getState().data.status).toBe('loading'));
    grid.stop();
    expect(grid.getState().data).toMatchObject({ status: 'idle', fetching: false });
    request.resolve({ rows: [rows[0]!] });
    await Promise.all([first, second]);
    grid.destroy();
  });

  it('deduplicates controlled actions with an in-flight controller', async () => {
    const request = deferred<void>();
    const run = vi.fn(() => request.promise);
    const controlledActions: GridState<Row>['actions'] = { pending: {}, errors: {} };
    const grid = createGrid<Row>({
      definition: definition({
        actions: [{ id: 'sync', label: 'Sync', placement: 'toolbar', run }],
      }),
      source: createLocalSource(rows),
      state: { actions: controlledActions },
    });
    await grid.start();
    const first = grid.actions.run('sync');
    const second = grid.actions.run('sync');
    expect(run).toHaveBeenCalledOnce();
    request.resolve();
    await Promise.all([first, second]);
    grid.destroy();
  });

  it('requires an identity to hot-swap functional row-key callbacks safely', () => {
    const source = createLocalSource(rows);
    const identified = (rowKey: (row: Row) => number) =>
      definition({ rowKey, rowKeyIdentity: 'id-v1' });
    const grid = createGrid<Row>({ definition: identified((row) => row.id), source });
    expect(() =>
      grid.updateOptions({ definition: identified((row) => row.id), source }),
    ).not.toThrow();
    expect(grid.definition.getRowKey(rows[0]!)).toBe(1);
    grid.destroy();

    const unsafe = createGrid<Row>({
      definition: definition({ rowKey: (row) => row.id }),
      source,
    });
    expect(() =>
      unsafe.updateOptions({
        definition: definition({ rowKey: (row) => row.id }),
        source,
      }),
    ).toThrow('functional grid rowKey');
    unsafe.destroy();
  });

  it('serializes reentrant notifications and isolates every observer failure', () => {
    const order: string[] = [];
    const eventStates: string[] = [];
    const onError = vi.fn(() => order.push('error'));
    const onStateChange = vi.fn((state: GridState<Row>) => {
      order.push(`state:${state.query.keyword}`);
      throw new Error('state observer');
    });
    const grid = createGrid<Row>({
      definition: definition(),
      source: createLocalSource(rows),
      onError,
      onStateChange,
    });
    let nested = false;
    grid.subscribe(() => {
      order.push('listener:first');
      if (!nested) {
        nested = true;
        grid.query.setKeyword('inner');
      }
    });
    const throwingListener = vi.fn(() => {
      order.push('listener:throw');
      throw new Error('listener observer');
    });
    grid.subscribe(throwingListener);
    grid.subscribeEvent((event, state) => {
      order.push(`event:${event.type}`);
      eventStates.push(state.query.keyword);
    });

    expect(() => grid.query.setKeyword('outer')).not.toThrow();
    expect(throwingListener).toHaveBeenCalledTimes(2);
    expect(onStateChange).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(4);
    expect(order.filter((item) => item === 'event:query.keyword')).toHaveLength(2);
    expect(order.indexOf('state:outer')).toBeLessThan(order.indexOf('state:inner'));
    expect(eventStates).toEqual(['outer', 'inner']);
    grid.destroy();
  });

  it('delivers each queued event to the onStateChange observer captured by its commit', () => {
    const firstObserver = vi.fn();
    const replacementObserver = vi.fn();
    const gridDefinition = definition();
    const source = createLocalSource(rows);
    const grid = createGrid<Row>({
      definition: gridDefinition,
      source,
      onStateChange: firstObserver,
    });
    let replaced = false;
    grid.subscribe(() => {
      if (replaced) return;
      replaced = true;
      grid.updateOptions({
        definition: gridDefinition,
        source,
        onStateChange: replacementObserver,
      });
    });

    grid.query.setKeyword('snapshot');
    expect(firstObserver).toHaveBeenCalledOnce();
    expect(firstObserver.mock.calls[0]?.[0].query.keyword).toBe('snapshot');
    expect(replacementObserver).not.toHaveBeenCalled();
    grid.destroy();
  });

  it('clears editing when a controlled result removes the active row and keeps case-sensitive option requests distinct', async () => {
    const load = vi.fn(async ({ search }: { search: string }) => [
      { label: search, value: search },
    ]);
    const grid = createGrid<Row>({
      definition: definition({
        fields: [{ id: 'name', title: 'Name', edit: true, options: { load } }],
        editing: { reloadOnSave: false, save: async () => undefined },
      }),
      source: createControlledSource({
        datasetKey: 'editing-result',
        resultDatasetKey: 'editing-result',
        result: { rows: [rows[0]!] },
      }),
    });
    await grid.start();
    grid.editing.begin(rows[0]!, 'name');
    expect(grid.getState().editing.active?.rowKey).toBe(1);
    grid.updateOptions({
      definition: definition({
        fields: [{ id: 'name', title: 'Name', edit: true, options: { load } }],
        editing: { reloadOnSave: false, save: async () => undefined },
      }),
      source: createControlledSource({
        datasetKey: 'editing-result',
        resultDatasetKey: 'editing-result',
        result: { rows: [rows[1]!] },
      }),
    });
    expect(grid.getState().editing.active).toBeUndefined();

    await expect(grid.options.load('name', 'US')).resolves.toEqual([{ label: 'US', value: 'US' }]);
    await expect(grid.options.load('name', 'us')).resolves.toEqual([{ label: 'us', value: 'us' }]);
    expect(load).toHaveBeenCalledTimes(2);
    grid.destroy();
  });

  it('canonicalizes grouped column order and rejects interleaved controlled state', () => {
    interface GroupRow {
      id: number;
      a: string;
      b: string;
      c: string;
      d: string;
    }
    const groupedDefinition: GridDefinition<GroupRow> = {
      id: 'grouped-columns',
      rowKey: 'id',
      fields: ['a', 'b', 'c', 'd'].map((id) => ({ id, title: id })),
      columns: [
        {
          id: 'first',
          children: [
            { id: 'a', fieldId: 'a' },
            { id: 'b', fieldId: 'b' },
          ],
        },
        {
          id: 'second',
          children: [
            { id: 'c', fieldId: 'c' },
            { id: 'd', fieldId: 'd' },
          ],
        },
      ],
    };
    const grid = createGrid<GroupRow>({
      definition: groupedDefinition,
      source: createLocalSource([]),
    });
    grid.columns.setOrder(['a', 'c', 'b', 'd']);
    expect(grid.getState().columns.order).toEqual(['a', 'b', 'c', 'd']);
    const interleaved = { ...grid.getState().columns, order: ['a', 'c', 'b', 'd'] };
    expect(() =>
      grid.updateOptions({
        definition: groupedDefinition,
        source: createLocalSource([]),
        state: { columns: interleaved },
      }),
    ).toThrow('cannot interleave');
    expect(grid.getState().columns.order).toEqual(['a', 'b', 'c', 'd']);
    grid.destroy();
  });

  it('flushes debounced persistence deterministically and remains safe during destroy', async () => {
    vi.useFakeTimers();
    try {
      const request = deferred<void>();
      const save = vi.fn(() => request.promise);
      const grid = createGrid<Row>({
        definition: definition(),
        source: createLocalSource(rows),
        persistence: { identity: 'flush-test', load: async () => null, save },
      });
      await grid.start();
      grid.views.create('Flush me');
      const flushing = grid.flushPersistence();
      await Promise.resolve();
      expect(save).toHaveBeenCalledOnce();
      grid.destroy();
      request.resolve();
      await expect(flushing).resolves.toBeUndefined();
      expect(save).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reference-counts runtime projection requirements without changing selection scope', async () => {
    interface ProjectionRow {
      id: number;
      name: string;
      secret: string;
    }
    const selects: string[][] = [];
    const read = vi.fn(async ({ request }: { request: { select?: string[] } }) => {
      selects.push(request.select || []);
      return { rows: [{ id: 1, name: 'One', secret: 'S' }], total: { value: 1 } };
    });
    const grid = createGrid<ProjectionRow>({
      definition: {
        id: 'runtime-projection',
        rowKey: 'id',
        fields: [
          { id: 'name', title: 'Name' },
          { id: 'secret', title: 'Secret', column: false },
        ],
      },
      source: createRemoteSource(read, { capabilities: { projection: true } }),
    });
    await grid.start();
    grid.selection.selectPage();
    expect(selects.at(-1)).not.toContain('secret');

    const firstCleanup = grid.projection.register(['secret']);
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(selects.at(-1)).toContain('secret');
    expect(grid.getState().selection).toEqual({ mode: 'explicit', selectedKeys: [1] });

    const secondCleanup = grid.projection.register(['secret']);
    firstCleanup();
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(2);
    secondCleanup();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(3));
    expect(selects.at(-1)).not.toContain('secret');
    expect(grid.getState().selection).toEqual({ mode: 'explicit', selectedKeys: [1] });
    grid.destroy();
  });

  it('notifies a controlled source when enabling projection changes the request', async () => {
    interface ProjectionRow {
      id: number;
      name: string;
      secret: string;
    }
    const gridDefinition: GridDefinition<ProjectionRow> = {
      id: 'controlled-projection-capability',
      rowKey: 'id',
      fields: [
        { id: 'name', title: 'Name' },
        { id: 'secret', title: 'Secret', column: false },
      ],
    };
    const result = { rows: [{ id: 1, name: 'One', secret: 'S' }] };
    const onQueryChange = vi.fn();
    const grid = createGrid<ProjectionRow>({
      definition: gridDefinition,
      source: createControlledSource({
        datasetKey: 'projection',
        resultDatasetKey: 'projection',
        result,
        onQueryChange,
      }),
    });
    await grid.start();
    onQueryChange.mockClear();
    grid.projection.register(['secret']);

    grid.updateOptions({
      definition: gridDefinition,
      source: createControlledSource({
        datasetKey: 'projection',
        resultDatasetKey: 'projection',
        result,
        onQueryChange,
        capabilities: { projection: true },
      }),
    });
    expect(onQueryChange).toHaveBeenCalledOnce();
    expect(onQueryChange.mock.calls[0]?.[1].select).toEqual(
      expect.arrayContaining(['name', 'secret']),
    );
    grid.destroy();
  });

  it('publishes runtime-only definition and projection changes without changing grid state', () => {
    const firstDefinition = definition({ fields: [{ id: 'name', title: 'First' }] });
    const secondDefinition = definition({ fields: [{ id: 'name', title: 'Second' }] });
    const source = createLocalSource(rows);
    const onStateChange = vi.fn();
    const grid = createGrid<Row>({ definition: firstDefinition, source, onStateChange });
    const stateListener = vi.fn();
    const runtimeListener = vi.fn();
    grid.subscribe(stateListener);
    grid.subscribeRuntime(runtimeListener);
    const before = grid.getState();

    grid.updateOptions({ definition: secondDefinition, source, onStateChange });
    expect(grid.getRuntimeRevision()).toBe(1);
    expect(runtimeListener).toHaveBeenCalledOnce();
    expect(grid.getState()).toMatchObject(before);
    expect(grid.getState().query).toBe(before.query);
    expect(grid.getState().columns).toBe(before.columns);
    expect(grid.getState().data).toBe(before.data);
    expect(stateListener).not.toHaveBeenCalled();
    expect(onStateChange).not.toHaveBeenCalled();

    grid.updateOptions({ definition: secondDefinition, source, onStateChange });
    expect(grid.getRuntimeRevision()).toBe(1);
    const firstCleanup = grid.projection.register(['name']);
    expect(grid.getRuntimeRevision()).toBe(2);
    const secondCleanup = grid.projection.register(['name']);
    expect(grid.getRuntimeRevision()).toBe(2);
    firstCleanup();
    expect(grid.getRuntimeRevision()).toBe(2);
    secondCleanup();
    expect(grid.getRuntimeRevision()).toBe(3);
    secondCleanup();
    expect(grid.getRuntimeRevision()).toBe(3);
    grid.destroy();
  });

  it('corrects an offset page after an exact total shrinks despite stale pageInfo', async () => {
    const read = vi.fn(async ({ query }: { query: GridQuery }) => {
      const page = query.pagination.type === 'offset' ? query.pagination.page : 1;
      if (page > 2) {
        return {
          rows: [],
          total: { value: 2, accuracy: 'exact' as const },
          pageInfo: { hasPrevious: false, hasNext: false },
        };
      }
      return {
        rows: [rows[page - 1]!],
        total: { value: 2, accuracy: 'exact' as const },
        pageInfo: { hasPrevious: page > 1, hasNext: page < 2 },
      };
    });
    const grid = createGrid<Row>({
      definition: definition(),
      source: createRemoteSource(read),
    });
    await grid.start();
    grid.query.setPage(4);
    await vi.waitFor(() =>
      expect(grid.getState().query.pagination).toEqual({ type: 'offset', page: 2, pageSize: 1 }),
    );
    await vi.waitFor(() => expect(grid.getState().data.rows[0]?.id).toBe(2));
    expect(grid.getState().data.error).toBeUndefined();
    grid.destroy();
  });

  it('does not let a late persistence hydrate overwrite user preferences changed meanwhile', async () => {
    const loading = deferred<GridPersistedState | null>();
    const columns: GridColumnState = {
      order: ['name'],
      hidden: [],
      widths: { name: 160 },
      pinned: { name: null },
      density: 'compact',
    };
    const persisted: GridPersistedState = {
      protocol: 'huiyun.data-grid/preferences/v1',
      gridId: 'store-test',
      revision: 1,
      columns,
      views: [
        {
          id: 'saved',
          name: 'Saved',
          query: {
            keyword: 'persisted',
            filters: { id: 'root', type: 'group', logic: 'and', children: [] },
            sorts: [],
          },
          columns,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      activeViewId: 'saved',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const grid = createGrid<Row>({
      definition: definition(),
      source: createLocalSource(rows),
      persistence: { load: () => loading.promise, save: async () => undefined },
    });
    const starting = grid.start();
    grid.query.setKeyword('user input');
    grid.columns.setDensity('comfortable');
    loading.resolve(persisted);
    await starting;
    expect(grid.getState().query.keyword).toBe('user input');
    expect(grid.getState().columns.density).toBe('comfortable');
    expect(grid.getState().views.items[0]?.id).toBe('saved');
    expect(grid.getState().views.activeId).toBeUndefined();
    grid.destroy();
  });

  it('keeps an active view dirty when a late hydrate arrives after query changes', async () => {
    const loading = deferred<GridPersistedState | null>();
    const columns: GridColumnState = {
      order: ['name'],
      hidden: [],
      widths: { name: 160 },
      pinned: { name: null },
      density: 'compact',
    };
    const activeView = {
      id: 'active',
      name: 'Active',
      query: {
        keyword: 'saved',
        filters: { id: 'root', type: 'group' as const, logic: 'and' as const, children: [] },
        sorts: [],
      },
      columns,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const persisted: GridPersistedState = {
      protocol: 'huiyun.data-grid/preferences/v1',
      gridId: 'store-test',
      revision: 1,
      columns,
      views: [activeView],
      activeViewId: activeView.id,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const grid = createGrid<Row>({
      definition: definition(),
      source: createLocalSource(rows),
      defaultState: {
        query: { keyword: 'already-dirty' },
        views: { activeId: activeView.id, items: [activeView], dirty: true },
      },
      persistence: { load: () => loading.promise, save: async () => undefined },
    });
    const starting = grid.start();
    grid.query.setKeyword('changed while loading');
    loading.resolve(persisted);
    await starting;
    expect(grid.getState().views.activeId).toBe(activeView.id);
    expect(grid.getState().views.dirty).toBe(true);
    expect(grid.getState().query.keyword).toBe('changed while loading');
    grid.destroy();
  });

  it('reconciles an active persisted view against current source capabilities', async () => {
    const columns: GridColumnState = {
      order: ['name'],
      hidden: [],
      widths: { name: 160 },
      pinned: { name: null },
      density: 'compact',
    };
    const persisted: GridPersistedState = {
      protocol: 'huiyun.data-grid/preferences/v1',
      gridId: 'store-test',
      revision: 1,
      columns,
      views: [
        {
          id: 'broad-query',
          name: 'Broad query',
          query: {
            keyword: 'hidden search',
            filters: {
              id: 'root',
              type: 'group',
              logic: 'and',
              children: [
                {
                  id: 'contains',
                  type: 'condition',
                  fieldId: 'name',
                  operator: 'contains',
                  value: 'One',
                },
              ],
            },
            sorts: [],
          },
          columns: { ...columns, density: 'comfortable' },
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      activeViewId: 'broad-query',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const grid = createGrid<Row>({
      definition: definition(),
      source: createRemoteSource<Row>(async () => ({ rows: [] }), {
        capabilities: { search: false, filter: { operators: ['equals'] } },
      }),
      defaultState: {
        query: {
          filters: {
            id: 'root',
            type: 'group',
            logic: 'and',
            children: [
              {
                id: 'old-equals',
                type: 'condition',
                fieldId: 'name',
                operator: 'equals',
                value: 'Old',
              },
            ],
          },
        },
      },
      persistence: { load: async () => persisted, save: async () => undefined },
    });
    await grid.start();
    expect(grid.getState().views.activeId).toBeUndefined();
    expect(grid.getState().query.keyword).toBe('');
    expect(grid.getState().query.filters.children).toEqual([]);
    expect(grid.getState().columns.density).toBe('compact');
    expect(grid.getState().views.items[0]?.columns.density).toBe('comfortable');
    grid.destroy();
  });

  it('rejects malformed editing, action, data and query slices transactionally', async () => {
    const gridDefinition = definition();
    const source = createLocalSource(rows);
    const grid = createGrid<Row>({ definition: gridDefinition, source });
    await grid.start();
    const before = grid.getState();
    expect(() =>
      grid.updateOptions({
        definition: gridDefinition,
        source,
        state: { actions: { pending: { invalid: 'yes' }, errors: {} } as never },
      }),
    ).toThrow('action state protocol');
    expect(() =>
      grid.updateOptions({
        definition: gridDefinition,
        source,
        state: {
          editing: {
            saving: false,
            active: { rowKey: 1, fieldId: 'missing', previousValue: '', draft: '' },
          },
        },
      }),
    ).toThrow('editable field');
    expect(() =>
      grid.updateOptions({
        definition: gridDefinition,
        source,
        state: { data: { ...before.data, rows: [rows[0]!, { ...rows[0]! }] } },
      }),
    ).toThrow('duplicate row key');
    expect(() =>
      grid.updateOptions({
        definition: gridDefinition,
        source: createRemoteSource<Row>(async () => ({ rows: [] }), {
          capabilities: { filter: { logic: 'and' } },
        }),
        state: {
          query: {
            ...before.query,
            filters: {
              id: 'root',
              type: 'group',
              logic: 'and',
              children: [
                {
                  id: 'typo',
                  type: 'condition',
                  fieldId: 'naem',
                  operator: 'equals',
                  value: 'One',
                },
              ],
            },
          },
        },
      }),
    ).toThrow('not filterable');
    expect(grid.getState()).toBe(before);
    grid.destroy();
  });
});
