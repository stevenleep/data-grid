import type {
  GridCapabilities,
  GridControlledSource,
  GridDataSource,
  GridLocalSource,
  GridReadResult,
  GridRemoteSource,
  GridResolvedCapabilities,
} from './types';
import { stableStringify } from './model';

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
): GridReadResult<Row> {
  const total = result.total
    ? { ...result.total, value: Math.max(0, Math.trunc(result.total.value)) }
    : undefined;
  return {
    ...result,
    rows: Array.isArray(result.rows) ? result.rows : [],
    total,
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
