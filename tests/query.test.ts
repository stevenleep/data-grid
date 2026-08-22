import { describe, expect, it } from 'vitest';
import {
  applyLocalGridQuery,
  compileGridQuery,
  createFilterCondition,
  createFilterGroup,
  getRequestScopeSignature,
  getRequestSignature,
  resolveGridCapabilities,
  resolveGridDefinition,
  validateGridQuery,
  createRemoteSource,
  type GridQuery,
} from '../src/core';

interface Row {
  id: number;
  profile: { name: string };
  score: number;
  tags: string[];
}

const definition = resolveGridDefinition<Row>({
  id: 'query-test',
  rowKey: 'id',
  fields: [
    {
      id: 'name',
      title: 'Name',
      path: ['profile', 'name'],
      transport: { filterKey: 'profile_name', sortKey: 'name_sort', selectKey: 'name' },
      filter: true,
      sort: true,
    },
    { id: 'score', title: 'Score', valueType: 'number', filter: true, sort: true },
    { id: 'tags', title: 'Tags', valueType: 'multiSelect', filter: true },
  ],
});

function makeQuery(): GridQuery {
  return {
    pagination: { type: 'offset', page: 1, pageSize: 20 },
    keyword: '  ada  ',
    filters: createFilterGroup('and', [createFilterCondition('name', 'contains', 'a')]),
    sorts: [{ id: 'ui-sort-id', fieldId: 'name', direction: 'asc' }],
    projection: ['name', 'score', 'name'],
  };
}

describe('query protocol', () => {
  it('compiles transport keys, projection and semantic nodes without UI ids', () => {
    const request = compileGridQuery(makeQuery(), definition);
    expect(request).toEqual({
      pagination: { type: 'offset', page: 1, pageSize: 20 },
      keyword: 'ada',
      filter: {
        logic: 'and',
        children: [{ field: 'profile_name', operator: 'contains', value: 'a' }],
      },
      sort: [{ field: 'name_sort', direction: 'asc' }],
      select: ['name', 'score'],
    });
    expect(JSON.stringify(request)).not.toContain('ui-sort-id');
  });

  it('gives equivalent UI query trees the same request signatures', () => {
    const first = makeQuery();
    const second = makeQuery();
    first.filters.id = 'first-group';
    second.filters.id = 'second-group';
    first.sorts[0]!.id = 'first-sort';
    second.sorts[0]!.id = 'second-sort';

    const firstRequest = compileGridQuery(first, definition);
    const secondRequest = compileGridQuery(second, definition);
    expect(getRequestSignature(firstRequest)).toBe(getRequestSignature(secondRequest));
    expect(getRequestScopeSignature(firstRequest)).toBe(getRequestScopeSignature(secondRequest));
  });

  it('applies nested local filtering, keyword search, stable sorting and paging', () => {
    const rows: Row[] = [
      { id: 1, profile: { name: 'Alpha' }, score: 80, tags: ['red', 'blue'] },
      { id: 2, profile: { name: 'Beta' }, score: 90, tags: ['green'] },
      { id: 3, profile: { name: 'Gamma' }, score: 70, tags: ['blue'] },
    ];
    const query: GridQuery = {
      pagination: { type: 'offset', page: 1, pageSize: 1 },
      keyword: 'a',
      filters: createFilterGroup('and', [
        createFilterGroup('or', [
          createFilterCondition('score', 'greaterThanOrEqual', 80),
          createFilterCondition('tags', 'containsAny', ['blue']),
        ]),
      ]),
      sorts: [{ id: 'score', fieldId: 'score', direction: 'desc', nulls: 'last' }],
    };
    const result = applyLocalGridQuery(rows, query, definition);

    expect(result.total).toEqual({ value: 3, accuracy: 'exact' });
    expect(result.rows.map((row) => row.id)).toEqual([2]);
    expect(result.pageInfo?.hasNext).toBe(true);
  });

  it('validates the backend capability contract before reading', () => {
    const source = createRemoteSource<Row>(async () => ({ rows: [] }), {
      capabilities: {
        filter: { logic: 'and', maxDepth: 1, maxConditions: 1 },
        sort: { max: 1, nulls: false },
      },
    });
    const capabilities = resolveGridCapabilities(source);
    const query = makeQuery();
    query.filters = createFilterGroup('or', [createFilterCondition('name', 'contains', 'a')]);
    expect(() => validateGridQuery(query, definition, capabilities)).toThrow(
      'supports AND filters only',
    );
  });

  it('validates keyword search and filter negation independently', () => {
    const source = createRemoteSource<Row>(async () => ({ rows: [] }), {
      capabilities: { search: false, filter: { logic: 'nested', negation: false } },
    });
    const capabilities = resolveGridCapabilities(source);
    const query = makeQuery();
    expect(() => validateGridQuery(query, definition, capabilities)).toThrow(
      'does not support keyword search',
    );

    query.keyword = '';
    query.filters.negated = true;
    expect(() => validateGridQuery(query, definition, capabilities)).toThrow(
      'does not support negated filters',
    );
  });

  it('rejects malformed pagination, incomplete filters and duplicate sorts', () => {
    const capabilities = resolveGridCapabilities(
      createRemoteSource<Row>(async () => ({ rows: [] }), {
        capabilities: {
          filter: { logic: 'nested', negation: true },
          sort: { max: 3, nulls: true },
        },
      }),
    );
    const query = makeQuery();
    query.pagination = { type: 'offset', page: 0, pageSize: 20 };
    expect(() => validateGridQuery(query, definition, capabilities)).toThrow('positive integer');

    query.pagination = { type: 'offset', page: 1, pageSize: 20 };
    query.keyword = '';
    query.filters = createFilterGroup('and', [createFilterCondition('name', 'equals')]);
    expect(() => validateGridQuery(query, definition, capabilities)).toThrow('is incomplete');

    query.filters = createFilterGroup();
    query.sorts = [
      { id: 'one', fieldId: 'name', direction: 'asc' },
      { id: 'two', fieldId: 'name', direction: 'desc' },
    ];
    expect(() => validateGridQuery(query, definition, capabilities)).toThrow(
      'cannot be sorted more than once',
    );
  });
});
