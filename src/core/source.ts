import type {
  GridCapabilities,
  GridControlledSource,
  GridDataSource,
  GridLocalSource,
  GridPagination,
  GridReadResult,
  GridRemoteSource,
  GridResolvedCapabilities,
} from './types';
import { stableStringify } from './model';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

function isGridOptionValue(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function validateSummary(summary: unknown[]): void {
  const ids = new Set<string>();
  summary.forEach((item, index) => {
    if (!isPlainRecord(item)) throw new Error(`Grid summary item ${index} must be an object.`);
    if (typeof item.id !== 'string' || !item.id.trim()) {
      throw new Error(`Grid summary item ${index} requires a non-empty id.`);
    }
    if (ids.has(item.id)) throw new Error(`Duplicate grid summary id: ${item.id}`);
    ids.add(item.id);
    if (!Object.prototype.hasOwnProperty.call(item, 'label') || item.label == null) {
      throw new Error(`Grid summary item "${item.id}" requires a label.`);
    }
    if (!Object.prototype.hasOwnProperty.call(item, 'value')) {
      throw new Error(`Grid summary item "${item.id}" requires a value.`);
    }
    if (item.fieldId !== undefined && (typeof item.fieldId !== 'string' || !item.fieldId.trim())) {
      throw new Error(`Grid summary item "${item.id}" has an invalid fieldId.`);
    }
    if (
      item.aggregate !== undefined &&
      (typeof item.aggregate !== 'string' || !item.aggregate.trim())
    ) {
      throw new Error(`Grid summary item "${item.id}" has an invalid aggregate.`);
    }
    if (
      item.scope !== undefined &&
      (typeof item.scope !== 'string' ||
        !['page', 'query', 'selection', 'dataset'].includes(item.scope))
    ) {
      throw new Error(`Grid summary item "${item.id}" has an invalid scope.`);
    }
    if (item.render !== undefined && typeof item.render !== 'function') {
      throw new Error(`Grid summary item "${item.id}" has an invalid renderer.`);
    }
  });
}

function validateFacets(facets: Record<string, unknown>): void {
  Object.entries(facets).forEach(([field, options]) => {
    if (!field.trim()) throw new Error('Grid result facet keys cannot be empty.');
    if (!Array.isArray(options)) {
      throw new Error(`Grid result facet "${field}" must be an array.`);
    }
    const values = new Set<string>();
    options.forEach((option, index) => {
      if (!isPlainRecord(option)) {
        throw new Error(`Grid result facet "${field}" option ${index} must be an object.`);
      }
      if (!Object.prototype.hasOwnProperty.call(option, 'label') || option.label == null) {
        throw new Error(`Grid result facet "${field}" option ${index} requires a label.`);
      }
      if (
        !Object.prototype.hasOwnProperty.call(option, 'value') ||
        !isGridOptionValue(option.value)
      ) {
        throw new Error(`Grid result facet "${field}" option ${index} has an invalid value.`);
      }
      const valueKey = `${typeof option.value}:${String(option.value)}`;
      if (values.has(valueKey)) {
        throw new Error(`Grid result facet "${field}" contains duplicate option values.`);
      }
      values.add(valueKey);
      if (option.color !== undefined && typeof option.color !== 'string') {
        throw new Error(`Grid result facet "${field}" option ${index} has an invalid color.`);
      }
      if (option.disabled !== undefined && typeof option.disabled !== 'boolean') {
        throw new Error(`Grid result facet "${field}" option ${index} has invalid disabled state.`);
      }
      if (option.meta !== undefined && !isPlainRecord(option.meta)) {
        throw new Error(`Grid result facet "${field}" option ${index} has invalid meta.`);
      }
    });
  });
}

const remoteDefaults: GridResolvedCapabilities = {
  pagination: 'offset',
  search: true,
  filter: {
    logic: 'and',
    negation: false,
    maxDepth: 1,
    maxConditions: Number.MAX_SAFE_INTEGER,
  },
  sort: { max: 1, nulls: false },
  projection: false,
  summary: false,
  facets: false,
  selectAllMatching: false,
};

const localDefaults: GridResolvedCapabilities = {
  pagination: 'offset',
  search: true,
  filter: {
    logic: 'nested',
    negation: true,
    maxDepth: Number.MAX_SAFE_INTEGER,
    maxConditions: Number.MAX_SAFE_INTEGER,
  },
  sort: { max: Number.MAX_SAFE_INTEGER, nulls: true },
  projection: false,
  summary: false,
  facets: false,
  selectAllMatching: true,
};

export function resolveGridCapabilities<Row extends object>(
  source: GridDataSource<Row>,
): GridResolvedCapabilities {
  const defaults = source.mode === 'local' ? localDefaults : remoteDefaults;
  const input = source.capabilities;
  const resolved = {
    ...defaults,
    ...input,
    filter: { ...defaults.filter, ...input?.filter },
    sort: { ...defaults.sort, ...input?.sort },
  };
  if (source.mode === 'local' && resolved.pagination !== 'offset') {
    throw new Error('Local grid sources support offset pagination only.');
  }
  return resolved;
}

export function createRemoteSource<Row extends object>(
  source: Omit<GridRemoteSource<Row>, 'mode'>,
): GridRemoteSource<Row>;
export function createRemoteSource<Row extends object>(
  read: GridRemoteSource<Row>['read'],
  options?: { capabilities?: GridCapabilities; policy?: GridRemoteSource<Row>['policy'] },
): GridRemoteSource<Row>;
export function createRemoteSource<Row extends object>(
  input: Omit<GridRemoteSource<Row>, 'mode'> | GridRemoteSource<Row>['read'],
  options: { capabilities?: GridCapabilities; policy?: GridRemoteSource<Row>['policy'] } = {},
): GridRemoteSource<Row> {
  return typeof input === 'function'
    ? { mode: 'remote', read: input, ...options }
    : { mode: 'remote', ...input };
}

export function createLocalSource<Row extends object>(
  rows: readonly Row[],
  capabilities?: GridCapabilities,
): GridLocalSource<Row> {
  return { mode: 'local', rows, capabilities };
}

export function createControlledSource<Row extends object>(
  source: Omit<GridControlledSource<Row>, 'mode'>,
): GridControlledSource<Row> {
  return { mode: 'controlled', ...source };
}

export function normalizeGridResult<Row extends object>(
  result: GridReadResult<Row>,
  pagination?: GridPagination,
): GridReadResult<Row> {
  if (!isPlainRecord(result)) throw new Error('Grid result must be a plain object.');
  if (!Array.isArray(result.rows)) throw new Error('Grid result rows must be an array.');
  if (result.rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error('Every grid result row must be an object.');
  }
  let total: GridReadResult<Row>['total'];
  if (result.total !== undefined) {
    if (!isPlainRecord(result.total)) throw new Error('Grid result total must be an object.');
    if (!Number.isFinite(result.total.value) || !Number.isInteger(result.total.value)) {
      throw new Error('Grid result total must be a finite integer.');
    }
    if (result.total.value < 0) throw new Error('Grid result total cannot be negative.');
    if (
      result.total.accuracy !== undefined &&
      !['exact', 'estimated', 'atLeast'].includes(result.total.accuracy)
    ) {
      throw new Error(`Unknown grid total accuracy: ${String(result.total.accuracy)}`);
    }
    total = { ...result.total };
  }

  if (result.pageInfo !== undefined && !isPlainRecord(result.pageInfo)) {
    throw new Error('Grid result pageInfo must be an object.');
  }
  const pageInfo = result.pageInfo ? { ...result.pageInfo } : undefined;
  if (pageInfo) {
    if (pageInfo.hasNext !== undefined && typeof pageInfo.hasNext !== 'boolean') {
      throw new Error('Grid pageInfo.hasNext must be a boolean.');
    }
    if (pageInfo.hasPrevious !== undefined && typeof pageInfo.hasPrevious !== 'boolean') {
      throw new Error('Grid pageInfo.hasPrevious must be a boolean.');
    }
    if (
      pageInfo.nextCursor !== undefined &&
      (typeof pageInfo.nextCursor !== 'string' || !pageInfo.nextCursor.trim())
    ) {
      throw new Error('Grid pageInfo.nextCursor must be a non-empty string.');
    }
    if (
      pageInfo.previousCursor !== undefined &&
      (typeof pageInfo.previousCursor !== 'string' || !pageInfo.previousCursor.trim())
    ) {
      throw new Error('Grid pageInfo.previousCursor must be a non-empty string.');
    }
    if (pagination?.type === 'cursor') {
      if (pageInfo.nextCursor && pageInfo.hasNext === undefined) pageInfo.hasNext = true;
      if (pageInfo.previousCursor && pageInfo.hasPrevious === undefined) {
        pageInfo.hasPrevious = true;
      }
      if (pageInfo.hasNext === true && !pageInfo.nextCursor) {
        throw new Error('Cursor pagination requires nextCursor when hasNext is true.');
      }
      if (pageInfo.hasPrevious === true && !pageInfo.previousCursor) {
        throw new Error('Cursor pagination requires previousCursor when hasPrevious is true.');
      }
      if (pageInfo.hasNext === false && pageInfo.nextCursor) {
        throw new Error('Cursor pagination cannot provide nextCursor when hasNext is false.');
      }
      if (pageInfo.hasPrevious === false && pageInfo.previousCursor) {
        throw new Error(
          'Cursor pagination cannot provide previousCursor when hasPrevious is false.',
        );
      }
    }
  }

  if (result.summary !== undefined && !Array.isArray(result.summary)) {
    throw new Error('Grid result summary must be an array.');
  }
  if (result.summary) validateSummary(result.summary);
  if (result.warnings !== undefined && !Array.isArray(result.warnings)) {
    throw new Error('Grid result warnings must be an array.');
  }
  if (result.warnings?.some((warning) => warning == null)) {
    throw new Error('Grid result warnings cannot contain null values.');
  }
  if (result.facets !== undefined) {
    if (!isPlainRecord(result.facets)) throw new Error('Grid result facets must be an object.');
    validateFacets(result.facets);
  }
  if (
    result.snapshotId !== undefined &&
    (typeof result.snapshotId !== 'string' || !result.snapshotId.trim())
  ) {
    throw new Error('Grid result snapshotId must be a non-empty string.');
  }
  if (result.meta !== undefined && !isPlainRecord(result.meta)) {
    throw new Error('Grid result meta must be an object.');
  }
  return {
    ...result,
    rows: result.rows,
    total,
    pageInfo,
    summary: result.summary || [],
    facets: result.facets || {},
    warnings: result.warnings || [],
  };
}

export function sourceDataIdentity<Row extends object>(source: GridDataSource<Row>): unknown[] {
  if (source.mode === 'remote') {
    return [source.read, stableStringify(source.capabilities), stableStringify(source.policy)];
  }
  if (source.mode === 'local') {
    return [source.rows, stableStringify(source.capabilities)];
  }
  return [
    source.result,
    source.loading,
    source.refreshing,
    source.error,
    stableStringify(source.capabilities),
    source.onQueryChange,
  ];
}
