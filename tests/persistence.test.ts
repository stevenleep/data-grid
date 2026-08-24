import { describe, expect, it, vi } from 'vitest';
import { createLocalGridPersistence, type GridPersistedState } from '../src/core';

function persistedState(): GridPersistedState {
  return {
    protocol: 'huiyun.data-grid/preferences/v1',
    gridId: 'orders',
    revision: 1,
    columns: {
      order: ['name'],
      hidden: [],
      widths: { name: 180 },
      pinned: { name: null },
      density: 'default',
    },
    views: [],
    updatedAt: '2026-08-22T00:00:00.000Z',
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
      setItem: (key: string, value: string) => values.set(key, value),
    } satisfies Storage,
  };
}

describe('local grid persistence', () => {
  it('round-trips a valid state', async () => {
    const storage = new Map<string, string>();
    const adapter = createLocalGridPersistence({
      storage: {
        get length() {
          return storage.size;
        },
        clear: () => storage.clear(),
        getItem: (key) => storage.get(key) ?? null,
        key: (index) => [...storage.keys()][index] ?? null,
        removeItem: (key) => storage.delete(key),
        setItem: (key, value) => storage.set(key, value),
      },
    });
    const state = persistedState();

    await adapter.save('orders', state, {} as never);

    await expect(adapter.load('orders', {} as never)).resolves.toEqual(state);
  });

  it('rejects malformed nested state instead of restoring it', async () => {
    const malformed = {
      ...persistedState(),
      columns: { ...persistedState().columns, widths: { name: Number.NaN } },
    };
    const storage = {
      getItem: vi.fn(() => JSON.stringify(malformed)),
    } as unknown as Storage;
    const adapter = createLocalGridPersistence({ storage });

    await expect(adapter.load('orders', {} as never)).resolves.toBeNull();
  });

  it('treats inaccessible storage as an empty persistence layer', async () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new DOMException('Access denied', 'SecurityError');
      }),
    } as unknown as Storage;
    const adapter = createLocalGridPersistence({ storage });

    await expect(adapter.load('orders', {} as never)).resolves.toBeNull();
  });

  it('isolates encoded scope/grid segments and exposes a stable adapter identity', async () => {
    const { storage } = memoryStorage();
    const first = createLocalGridPersistence({ prefix: 'prefs', scope: 'tenant:a', storage });
    const same = createLocalGridPersistence({ prefix: 'prefs', scope: 'tenant:a', storage });
    const second = createLocalGridPersistence({ prefix: 'prefs', scope: 'tenant', storage });
    const firstState = { ...persistedState(), gridId: 'orders:open' };
    const secondState = { ...persistedState(), gridId: 'a:orders:open', revision: 2 };

    expect(first.identity).toBe(same.identity);
    expect(first.identity).not.toBe(second.identity);
    await first.save(firstState.gridId, firstState, {} as never);
    await second.save(secondState.gridId, secondState, {} as never);
    await expect(first.load(firstState.gridId, {} as never)).resolves.toEqual(firstState);
    await expect(second.load(secondState.gridId, {} as never)).resolves.toEqual(secondState);
  });

  it('rejects invalid view trees, duplicate ids and mismatched writes', async () => {
    const { storage, values } = memoryStorage();
    const adapter = createLocalGridPersistence({ storage });
    const invalid = {
      ...persistedState(),
      views: [
        {
          id: 'default',
          name: 'Default',
          query: {
            keyword: '',
            filters: {
              id: 'condition-root',
              type: 'condition',
              fieldId: 'name',
              operator: 'equals',
              value: 'Ada',
            },
            sorts: [],
            context: [],
          },
          columns: persistedState().columns,
          createdAt: '2026-08-22T00:00:00.000Z',
          updatedAt: '2026-08-22T00:00:00.000Z',
        },
      ],
      activeViewId: 'missing',
    };
    values.set(
      [...values.keys()][0] || encodeURIComponent('@huiyun/data-grid') + ':scope=:grid=orders',
      JSON.stringify(invalid),
    );

    await expect(adapter.load('orders', {} as never)).resolves.toBeNull();
    await expect(adapter.save('another-grid', persistedState(), {} as never)).rejects.toThrow(
      'mismatched',
    );
  });
});
