import type {
  GridCapabilities,
  GridControlledSource,
  GridControlledSourceOptions,
  GridDataSource,
  GridLocalSource,
  GridOption,
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
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

export function normalizeGridOptions(input: unknown, label = 'Grid options'): GridOption[] {
  if (!Array.isArray(input)) throw new Error(`${label} must be an array.`);
  const values = new Set<string>();
  return input.map((item, index) => {
    if (!isPlainRecord(item)) throw new Error(`${label} option ${index} must be an object.`);
    if (!Object.prototype.hasOwnProperty.call(item, 'label') || item.label == null) {
      throw new Error(`${label} option ${index} requires a label.`);
    }
    if (!Object.prototype.hasOwnProperty.call(item, 'value') || !isGridOptionValue(item.value)) {
      throw new Error(`${label} option ${index} has an invalid value.`);
    }
    const valueKey = `${typeof item.value}:${String(item.value)}`;
    if (values.has(valueKey)) throw new Error(`${label} contains duplicate option values.`);
    values.add(valueKey);
    if (item.color !== undefined && typeof item.color !== 'string') {
      throw new Error(`${label} option ${index} has an invalid color.`);
    }
    if (item.disabled !== undefined && typeof item.disabled !== 'boolean') {
      throw new Error(`${label} option ${index} has invalid disabled state.`);
    }
    if (item.meta !== undefined && !isPlainRecord(item.meta)) {
      throw new Error(`${label} option ${index} has invalid meta.`);
    }
    return { ...item } as unknown as GridOption;
  });
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
    normalizeGridOptions(options, `Grid result facet "${field}"`);
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

function validateCapabilities(input: unknown): asserts input is GridCapabilities | undefined {
  if (input === undefined) return;
  if (!isPlainRecord(input)) throw new Error('Grid source capabilities must be an object.');
  if (input.pagination !== undefined && !['offset', 'cursor'].includes(String(input.pagination))) {
    throw new Error(`Unknown grid pagination capability: ${String(input.pagination)}`);
  }
  ['search', 'projection', 'summary', 'facets', 'selectAllMatching'].forEach((key) => {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') {
      throw new Error(`Grid capability "${key}" must be a boolean.`);
    }
  });
  if (input.filter !== undefined) {
    if (!isPlainRecord(input.filter)) throw new Error('Grid filter capability must be an object.');
    if (
      input.filter.logic !== undefined &&
      !['and', 'flat', 'nested'].includes(String(input.filter.logic))
    ) {
      throw new Error(`Unknown grid filter logic: ${String(input.filter.logic)}`);
    }
    if (input.filter.negation !== undefined && typeof input.filter.negation !== 'boolean') {
      throw new Error('Grid filter negation capability must be a boolean.');
    }
    for (const [key, minimum] of [
      ['maxDepth', 1],
      ['maxConditions', 0],
    ] as const) {
      const value = input.filter[key];
      if (value !== undefined && (!Number.isSafeInteger(value) || (value as number) < minimum)) {
        throw new Error(`Grid filter ${key} must be a safe integer >= ${minimum}.`);
      }
    }
    if (input.filter.operators !== undefined) {
      if (
        !Array.isArray(input.filter.operators) ||
        input.filter.operators.some((operator) => typeof operator !== 'string' || !operator.trim())
      ) {
        throw new Error('Grid filter operators must be non-empty strings.');
      }
      if (new Set(input.filter.operators).size !== input.filter.operators.length) {
        throw new Error('Grid filter operators cannot contain duplicates.');
      }
    }
  }
  if (input.sort !== undefined) {
    if (!isPlainRecord(input.sort)) throw new Error('Grid sort capability must be an object.');
    if (
      input.sort.max !== undefined &&
      (!Number.isSafeInteger(input.sort.max) || (input.sort.max as number) < 0)
    ) {
      throw new Error('Grid sort max must be a non-negative safe integer.');
    }
    if (input.sort.nulls !== undefined && typeof input.sort.nulls !== 'boolean') {
      throw new Error('Grid sort null capability must be a boolean.');
    }
  }
}

export function resolveGridCapabilities<Row extends object>(
  source: GridDataSource<Row>,
): GridResolvedCapabilities {
  if (!source || !['local', 'remote', 'controlled'].includes(String(source.mode))) {
    throw new Error(
      `Unknown grid source mode: ${String(source && (source as { mode?: unknown }).mode)}`,
    );
  }
  if (
    source.datasetKey !== undefined &&
    (typeof source.datasetKey !== 'string' || !source.datasetKey.trim())
  ) {
    throw new Error('Grid source datasetKey must be a non-empty string.');
  }
  if (source.mode === 'remote') {
    if (
      source.driverKey !== undefined &&
      !(
        (typeof source.driverKey === 'string' && source.driverKey.trim()) ||
        (typeof source.driverKey === 'number' && Number.isFinite(source.driverKey))
      )
    ) {
      throw new Error('Grid source driverKey must be a non-empty string or finite number.');
    }
    if (typeof source.read !== 'function') {
      throw new Error('Remote grid sources require a read function.');
    }
    if (source.policy !== undefined) {
      if (!isPlainRecord(source.policy)) throw new Error('Grid source policy must be an object.');
      for (const key of ['cacheTime', 'staleTime', 'maxCacheEntries'] as const) {
        const value = source.policy[key];
        if (
          value !== undefined &&
          (!Number.isSafeInteger(value) || value < (key === 'maxCacheEntries' ? 1 : 0))
        ) {
          throw new Error(`Grid source policy.${key} has an invalid value.`);
        }
      }
      if (
        source.policy.keepPreviousData !== undefined &&
        typeof source.policy.keepPreviousData !== 'boolean'
      ) {
        throw new Error('Grid source policy.keepPreviousData must be a boolean.');
      }
    }
  } else if (source.mode === 'local') {
    if (!Array.isArray(source.rows)) throw new Error('Local grid source rows must be an array.');
    if (source.rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
      throw new Error('Every local grid source row must be an object.');
    }
  } else {
    if (!isPlainRecord(source.result)) {
      throw new Error('Controlled grid sources require a result object.');
    }
    for (const key of ['loading', 'refreshing'] as const) {
      if (source[key] !== undefined && typeof source[key] !== 'boolean') {
        throw new Error(`Controlled grid source ${key} must be a boolean.`);
      }
    }
    if (source.onQueryChange !== undefined && typeof source.onQueryChange !== 'function') {
      throw new Error('Controlled grid source onQueryChange must be a function.');
    }
    if (
      source.resultRequestSignature !== undefined &&
      (typeof source.resultRequestSignature !== 'string' || !source.resultRequestSignature.trim())
    ) {
      throw new Error('Controlled grid source resultRequestSignature must be a non-empty string.');
    }
    if (
      source.datasetKey !== undefined &&
      (typeof source.resultDatasetKey !== 'string' || !source.resultDatasetKey.trim())
    ) {
      throw new Error(
        'Controlled grid sources with datasetKey require a non-empty resultDatasetKey.',
      );
    }
    if (source.datasetKey === undefined && source.resultDatasetKey !== undefined) {
      throw new Error('Controlled grid source resultDatasetKey requires datasetKey.');
    }
    if (source.error !== undefined) {
      if (
        !isPlainRecord(source.error) ||
        !Object.prototype.hasOwnProperty.call(source.error, 'value')
      ) {
        throw new Error('Controlled grid source error must be a provenance envelope.');
      }
      if (
        typeof source.error.requestSignature !== 'string' ||
        !source.error.requestSignature.trim()
      ) {
        throw new Error(
          'Controlled grid source error.requestSignature must be a non-empty string.',
        );
      }
      if (
        source.datasetKey !== undefined &&
        (typeof source.error.datasetKey !== 'string' || !source.error.datasetKey.trim())
      ) {
        throw new Error(
          'Controlled grid sources with datasetKey require error.datasetKey provenance.',
        );
      }
      if (source.datasetKey === undefined && source.error.datasetKey !== undefined) {
        throw new Error('Controlled grid source error.datasetKey requires source.datasetKey.');
      }
    }
  }
  const defaults = source.mode === 'local' ? localDefaults : remoteDefaults;
  const input = source.capabilities;
  validateCapabilities(input);
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
  options?: {
    datasetKey?: string;
    driverKey?: string | number;
    capabilities?: GridCapabilities;
    policy?: GridRemoteSource<Row>['policy'];
  },
): GridRemoteSource<Row>;
export function createRemoteSource<Row extends object>(
  input: Omit<GridRemoteSource<Row>, 'mode'> | GridRemoteSource<Row>['read'],
  options: {
    datasetKey?: string;
    driverKey?: string | number;
    capabilities?: GridCapabilities;
    policy?: GridRemoteSource<Row>['policy'];
  } = {},
): GridRemoteSource<Row> {
  return typeof input === 'function'
    ? { mode: 'remote', read: input, ...options }
    : { mode: 'remote', ...input };
}

export function createLocalSource<Row extends object>(
  rows: readonly Row[],
  capabilities?: GridCapabilities,
  datasetKey?: string,
): GridLocalSource<Row> {
  return { mode: 'local', rows, capabilities, datasetKey };
}

export function createControlledSource<Row extends object>(
  source: GridControlledSourceOptions<Row>,
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
    if (!Number.isSafeInteger(result.total.value)) {
      throw new Error('Grid result total must be a safe integer.');
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
  if (pagination && result.rows.length > pagination.pageSize) {
    throw new Error('Grid result rows cannot exceed the requested pageSize.');
  }
  if (total?.accuracy === 'exact' || (total && total.accuracy === undefined)) {
    if (total.value < result.rows.length) {
      throw new Error('Exact grid total cannot be smaller than the returned row count.');
    }
    if (pagination?.type === 'offset' && result.rows.length > 0) {
      const minimum = (pagination.page - 1) * pagination.pageSize + result.rows.length;
      if (total.value < minimum) {
        throw new Error('Exact grid total is inconsistent with the requested offset page.');
      }
    }
  }
  if (total?.accuracy === 'atLeast') {
    const minimum =
      pagination?.type === 'offset' && result.rows.length > 0
        ? (pagination.page - 1) * pagination.pageSize + result.rows.length
        : result.rows.length;
    if (total.value < minimum) {
      throw new Error('At-least grid total is smaller than the rows already observed.');
    }
  }
  if (
    pagination?.type === 'offset' &&
    total &&
    (total.accuracy === undefined || total.accuracy === 'exact') &&
    pageInfo
  ) {
    const lastPage = Math.max(1, Math.ceil(total.value / pagination.pageSize));
    // An empty result for an offset that became stale is valid; the store uses the
    // exact total to move back to lastPage before rendering this pageInfo.
    if (pagination.page <= lastPage) {
      const expectedPrevious = pagination.page > 1;
      const expectedNext = pagination.page * pagination.pageSize < total.value;
      if (pageInfo.hasPrevious !== undefined && pageInfo.hasPrevious !== expectedPrevious) {
        throw new Error('Grid pageInfo.hasPrevious is inconsistent with the exact total.');
      }
      if (pageInfo.hasNext !== undefined && pageInfo.hasNext !== expectedNext) {
        throw new Error('Grid pageInfo.hasNext is inconsistent with the exact total.');
      }
    }
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

function capabilitiesIdentity(capabilities: GridCapabilities | undefined): string {
  if (!capabilities) return '';
  return stableStringify({
    pagination: capabilities.pagination,
    search: capabilities.search,
    filter: capabilities.filter
      ? {
          logic: capabilities.filter.logic,
          negation: capabilities.filter.negation,
          maxDepth: capabilities.filter.maxDepth,
          maxConditions: capabilities.filter.maxConditions,
          operators: capabilities.filter.operators,
        }
      : undefined,
    sort: capabilities.sort
      ? { max: capabilities.sort.max, nulls: capabilities.sort.nulls }
      : undefined,
    projection: capabilities.projection,
    summary: capabilities.summary,
    facets: capabilities.facets,
    selectAllMatching: capabilities.selectAllMatching,
  });
}

export function sourceDataIdentity<Row extends object>(source: GridDataSource<Row>): unknown[] {
  if (source.mode === 'remote') {
    return [
      source.datasetKey,
      source.driverKey,
      // A declared dataset key is the semantic identity. React is then free to
      // refresh an inline reader closure without turning a render into a source
      // replacement, cache clear and forced reload. driverKey lets applications
      // invalidate the adapter independently. Without either key we preserve
      // the conservative legacy behavior and use the reader as the boundary.
      source.datasetKey === undefined && source.driverKey === undefined ? source.read : undefined,
      capabilitiesIdentity(source.capabilities),
      stableStringify({
        cacheTime: source.policy?.cacheTime,
        staleTime: source.policy?.staleTime,
        maxCacheEntries: source.policy?.maxCacheEntries,
        keepPreviousData: source.policy?.keepPreviousData,
      }),
    ];
  }
  if (source.mode === 'local') {
    return [source.datasetKey, source.rows, capabilitiesIdentity(source.capabilities)];
  }
  return [
    source.datasetKey,
    source.resultDatasetKey,
    source.result,
    source.resultRequestSignature,
    source.loading,
    source.refreshing,
    source.error?.datasetKey,
    source.error?.requestSignature,
    source.error?.value,
    capabilitiesIdentity(source.capabilities),
  ];
}
