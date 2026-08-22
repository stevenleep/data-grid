import { describe, expect, it, vi } from 'vitest';
import {
  createGrid,
  createLocalSource,
  createRemoteSource,
  type GridPersistence,
  type GridDefinition,
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
    expect(grid.getState().actions.pending['archive:1']).toBe(true);
    actionRequest.resolve();
    await action;
    expect(grid.getState().actions.pending['archive:1']).toBe(false);
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
});
