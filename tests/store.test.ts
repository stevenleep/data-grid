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
        result,
        capabilities: { selectAllMatching: true },
      });
    const grid = createGrid<Row>({
      definition: gridDefinition,
      source: source({ rows: [rows[0]!], total: { value: 3 } }),
    });
    await grid.start();
    grid.selection.selectPage();

    grid.updateOptions({
      definition: gridDefinition,
      source: source({ rows: [rows[1]!], total: { value: 3 } }),
    });
    expect(grid.selection.getSelectedRows()[0]?.name).toBe('One');

    grid.updateOptions({
      definition: gridDefinition,
      source: source({ rows: [{ id: 1, name: 'One refreshed' }], total: { value: 3 } }),
    });
    expect(grid.selection.getSelectedRows()[0]?.name).toBe('One refreshed');

    grid.selection.selectAllMatching();
    grid.selection.toggle(1, { id: 1, name: 'One refreshed' }, false);
    grid.updateOptions({
      definition: gridDefinition,
      source: source({ rows: [rows[1]!], total: { value: 5 } }),
    });
    expect(grid.getState().selection).toMatchObject({
      mode: 'allMatching',
      total: 5,
      excludedKeys: [1],
    });
    expect(grid.selection.getCount()).toBe(4);
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

  it('creates collision-proof action keys for action ids and typed row keys', () => {
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
    expect(grid.actions.key('a', { id: 1, name: '' })).not.toBe(
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

  it('reconciles a controlled query when source capabilities contract', async () => {
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
    ).not.toThrow();
    expect(grid.getState().query.keyword).toBe('');
    expect(grid.getState().query.filters).toMatchObject({ logic: 'and', children: [] });
    expect(grid.getState().query.sorts).toEqual([
      { id: 'name-sort', fieldId: 'name', direction: 'asc', nulls: undefined },
    ]);
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
});
