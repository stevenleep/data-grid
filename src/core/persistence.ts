import type { GridPersistence, GridPersistedState } from './types';

export interface LocalGridPersistenceOptions {
  prefix?: string;
  scope?: string;
  storage?: Storage;
}

function isPersistedState(value: unknown): value is GridPersistedState {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<GridPersistedState>;
  return (
    record.protocol === 'huiyun.data-grid/preferences/v1' &&
    typeof record.gridId === 'string' &&
    Boolean(record.columns) &&
    Array.isArray(record.views)
  );
}

export function createLocalGridPersistence<Row extends object = object>(
  options: LocalGridPersistenceOptions = {},
): GridPersistence<Row> {
  const prefix = options.prefix || '@huiyun/data-grid';
  const scope = options.scope ? `:${options.scope}` : '';
  const getStorage = () => options.storage || globalThis.localStorage;
  const key = (gridId: string) => `${prefix}${scope}:${gridId}`;
  const available = () =>
    Boolean(options.storage) || typeof globalThis.localStorage !== 'undefined';

  return {
    async load(gridId) {
      if (!available()) return null;
      const raw = getStorage().getItem(key(gridId));
      if (!raw) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        return isPersistedState(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    async save(gridId, state) {
      if (!available()) return;
      getStorage().setItem(key(gridId), JSON.stringify(state));
    },
    async clear(gridId) {
      if (!available()) return;
      getStorage().removeItem(key(gridId));
    },
  };
}
