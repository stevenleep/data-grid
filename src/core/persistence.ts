import type { GridPersistence, GridPersistedState } from './types';

export interface LocalGridPersistenceOptions {
  prefix?: string;
  scope?: string;
  storage?: Storage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
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

function isFilterNode(value: unknown): boolean {
  if (!isRecord(value) || typeof value.id !== 'string') return false;
  if (value.type === 'condition') {
    return (
      typeof value.fieldId === 'string' &&
      typeof value.operator === 'string' &&
      (value.value === undefined || isJsonValue(value.value))
    );
  }
  return (
    value.type === 'group' &&
    (value.logic === 'and' || value.logic === 'or') &&
    (value.negated === undefined || typeof value.negated === 'boolean') &&
    Array.isArray(value.children) &&
    value.children.every(isFilterNode)
  );
}

function isView(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.query)) return false;
  const query = value.query;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    (value.scope === undefined || ['private', 'shared', 'system'].includes(String(value.scope))) &&
    (value.readonly === undefined || typeof value.readonly === 'boolean') &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    typeof query.keyword === 'string' &&
    isFilterNode(query.filters) &&
    Array.isArray(query.sorts) &&
    query.sorts.every(
      (sort) =>
        isRecord(sort) &&
        typeof sort.id === 'string' &&
        typeof sort.fieldId === 'string' &&
        (sort.direction === 'asc' || sort.direction === 'desc') &&
        (sort.nulls === undefined || sort.nulls === 'first' || sort.nulls === 'last'),
    ) &&
    (query.projection === undefined || isStringArray(query.projection)) &&
    (query.context === undefined || isJsonValue(query.context)) &&
    isColumnState(value.columns) &&
    (value.meta === undefined || isJsonValue(value.meta))
  );
}

function isPersistedState(value: unknown): value is GridPersistedState {
  if (!isRecord(value)) return false;
  return (
    value.protocol === 'huiyun.data-grid/preferences/v1' &&
    typeof value.gridId === 'string' &&
    (typeof value.revision === 'string' ||
      (typeof value.revision === 'number' && Number.isFinite(value.revision))) &&
    isColumnState(value.columns) &&
    Array.isArray(value.views) &&
    value.views.every(isView) &&
    (value.activeViewId === undefined || typeof value.activeViewId === 'string') &&
    typeof value.updatedAt === 'string'
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
      try {
        const raw = getStorage().getItem(key(gridId));
        if (!raw) return null;
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
