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
});
