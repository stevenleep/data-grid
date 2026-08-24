import type { GridPersistence, GridPersistedState } from './types';
import { isGridJsonValue } from './query';

export interface LocalGridPersistenceOptions {
  prefix?: string;
  scope?: string;
  storage?: Storage;
  /** Explicit account/storage identity for deterministic adapter replacement. */
  identity?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'string' && item.trim().length > 0) &&
    new Set(value).size === value.length
  );
}

function isJsonRecord(value: unknown): value is Record<string, never> {
  return isRecord(value) && isGridJsonValue(value);
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isColumnState(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (!isStringArray(value.order) || !isStringArray(value.hidden)) return false;
  if (!isRecord(value.widths) || !isRecord(value.pinned)) return false;
  if (!['compact', 'default', 'comfortable'].includes(String(value.density))) return false;
  if (
    !Object.values(value.widths).every(
      (width) => typeof width === 'number' && Number.isFinite(width) && width > 0,
    )
  ) {
    return false;
  }
  return Object.values(value.pinned).every(
    (pinned) => pinned === null || pinned === 'left' || pinned === 'right',
  );
}

function isFilterNode(value: unknown, ids: Set<string>, root = false): boolean {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim() || ids.has(value.id)) {
    return false;
  }
  ids.add(value.id);
  if (value.type === 'condition') {
    return (
      !root &&
      typeof value.fieldId === 'string' &&
      Boolean(value.fieldId.trim()) &&
      typeof value.operator === 'string' &&
      Boolean(value.operator.trim()) &&
      (value.value === undefined || isGridJsonValue(value.value))
    );
  }
  return (
    value.type === 'group' &&
    (value.logic === 'and' || value.logic === 'or') &&
    (value.negated === undefined || typeof value.negated === 'boolean') &&
    Array.isArray(value.children) &&
    value.children.every((child) => isFilterNode(child, ids))
  );
}

function isView(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.query)) return false;
  const query = value.query;
  if (!isFilterNode(query.filters, new Set(), true)) return false;
  if (!Array.isArray(query.sorts)) return false;
  const sortIds = new Set<string>();
  const sortFields = new Set<string>();
  const sortsValid = query.sorts.every((sort) => {
    if (
      !isRecord(sort) ||
      typeof sort.id !== 'string' ||
      !sort.id.trim() ||
      sortIds.has(sort.id) ||
      typeof sort.fieldId !== 'string' ||
      !sort.fieldId.trim() ||
      sortFields.has(sort.fieldId) ||
      (sort.direction !== 'asc' && sort.direction !== 'desc') ||
      (sort.nulls !== undefined && sort.nulls !== 'first' && sort.nulls !== 'last')
    ) {
      return false;
    }
    sortIds.add(sort.id);
    sortFields.add(sort.fieldId);
    return true;
  });
  return (
    typeof value.id === 'string' &&
    Boolean(value.id.trim()) &&
    typeof value.name === 'string' &&
    Boolean(value.name.trim()) &&
    (value.scope === undefined || ['private', 'shared', 'system'].includes(String(value.scope))) &&
    (value.readonly === undefined || typeof value.readonly === 'boolean') &&
    (value.owner === undefined || typeof value.owner === 'string') &&
    isIsoDate(value.createdAt) &&
    isIsoDate(value.updatedAt) &&
    typeof query.keyword === 'string' &&
    sortsValid &&
    (query.projection === undefined || isStringArray(query.projection)) &&
    (query.context === undefined || isJsonRecord(query.context)) &&
    isColumnState(value.columns) &&
    (value.meta === undefined || isJsonRecord(value.meta))
  );
}

function isPersistedState(value: unknown): value is GridPersistedState {
  if (!isRecord(value)) return false;
  if (!(
    value.protocol === 'huiyun.data-grid/preferences/v1' &&
    typeof value.gridId === 'string' &&
    Boolean(value.gridId.trim()) &&
    ((typeof value.revision === 'string' && Boolean(value.revision.trim())) ||
      (typeof value.revision === 'number' && Number.isSafeInteger(value.revision))) &&
    isColumnState(value.columns) &&
    Array.isArray(value.views) &&
    value.views.every(isView) &&
    (value.activeViewId === undefined || typeof value.activeViewId === 'string') &&
    isIsoDate(value.updatedAt)
  )) {
    return false;
  }
  const viewIds = value.views.map((view) => view.id);
  if (new Set(viewIds).size !== viewIds.length) return false;
  return value.activeViewId === undefined || viewIds.includes(value.activeViewId);
}

/** Validates preferences returned by any local or remote persistence adapter. */
export function parseGridPersistedState(input: unknown): GridPersistedState {
  if (!isPersistedState(input)) {
    throw new Error('Grid preferences do not match huiyun.data-grid/preferences/v1.');
  }
  return JSON.parse(JSON.stringify(input)) as GridPersistedState;
}

const storageIdentities = new WeakMap<object, number>();
let storageIdentitySeed = 0;

function storageIdentity(storage: Storage | undefined): string {
  if (!storage) return 'global-local-storage';
  let identity = storageIdentities.get(storage);
  if (!identity) {
    storageIdentitySeed += 1;
    identity = storageIdentitySeed;
    storageIdentities.set(storage, identity);
  }
  return `storage-${identity}`;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

export function createLocalGridPersistence<Row extends object = object>(
  options: LocalGridPersistenceOptions = {},
): GridPersistence<Row> {
  const prefix = options.prefix ?? '@huiyun/data-grid';
  const scope = options.scope ?? '';
  if (typeof prefix !== 'string' || !prefix) {
    throw new Error('Local grid persistence prefix must be a non-empty string.');
  }
  if (typeof scope !== 'string') {
    throw new Error('Local grid persistence scope must be a string.');
  }
  if (
    options.identity !== undefined &&
    (typeof options.identity !== 'string' || !options.identity)
  ) {
    throw new Error('Local grid persistence identity must be a non-empty string.');
  }
  if (options.storage !== undefined && (!options.storage || typeof options.storage !== 'object')) {
    throw new Error('Local grid persistence storage must be an object.');
  }
  const getStorage = (): Storage | undefined => {
    if (options.storage) return options.storage;
    try {
      return typeof globalThis.localStorage === 'undefined' ? undefined : globalThis.localStorage;
    } catch {
      return undefined;
    }
  };
  const key = (gridId: string) =>
    `${segment(prefix)}:scope=${segment(scope)}:grid=${segment(gridId)}`;
  const identity =
    options.identity ?? `${segment(prefix)}:${segment(scope)}:${storageIdentity(options.storage)}`;

  return {
    identity,
    async load(gridId) {
      try {
        const storage = getStorage();
        if (!storage || typeof storage.getItem !== 'function') return null;
        const raw = storage.getItem(key(gridId));
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        const state = parseGridPersistedState(parsed);
        return state.gridId === gridId ? state : null;
      } catch {
        return null;
      }
    },
    async save(gridId, state) {
      if (!isPersistedState(state) || state.gridId !== gridId) {
        throw new Error('Refusing to persist an invalid or mismatched grid preference state.');
      }
      const storage = getStorage();
      if (!storage) return;
      if (typeof storage.setItem !== 'function') {
        throw new Error('Local grid persistence storage does not implement setItem.');
      }
      storage.setItem(key(gridId), JSON.stringify(state));
    },
    async clear(gridId) {
      const storage = getStorage();
      if (!storage) return;
      if (typeof storage.removeItem !== 'function') {
        throw new Error('Local grid persistence storage does not implement removeItem.');
      }
      storage.removeItem(key(gridId));
    },
  };
}
