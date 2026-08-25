import { describe, expect, it } from 'vitest';
import {
  applyLocalGridQuery,
  compileGridQuery,
  createFilterCondition,
  createFilterGroup,
  getFilterOperatorValueKind,
  getRequestScopeSignature,
  getRequestSignature,
  isGridJsonValue,
  matchesGridCondition,
  pruneFilterGroup,
  removeFilterNode,
  resolveGridCapabilities,
  resolveGridDefinition,
  serializeGridQuery,
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
      select: ['id', 'name', 'score'],
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

  it('searches relation labels across one and many values with explicit searchText precedence', () => {
    interface RelationSearchRow {
      id: string;
      owner: { customerCode: string; displayName?: string };
      reviewers: Array<{
        customerCode: string;
        displayName?: string;
        label?: string;
        name?: string;
        title?: string;
      }>;
    }
    const relationSearchDefinition = resolveGridDefinition<RelationSearchRow>({
      id: 'relation-local-search',
      rowKey: 'id',
      fields: [
        {
          id: 'owner',
          title: 'Owner',
          relation: {
            target: 'crm.customer',
            cardinality: 'one',
            keyField: 'customerCode',
            labelField: 'displayName',
          },
        },
        {
          id: 'reviewers',
          title: 'Reviewers',
          relation: {
            target: 'crm.customer',
            cardinality: 'many',
            keyField: 'customerCode',
            labelField: 'displayName',
          },
        },
      ],
    });
    const rows: RelationSearchRow[] = [
      {
        id: 'matching',
        owner: { customerCode: 'C1', displayName: 'Ada CRM' },
        reviewers: [
          { customerCode: 'C2', displayName: 'Grace Hopper' },
          { customerCode: 'C3', name: 'Fallback Name' },
          { customerCode: 'C6', label: 'Label Fallback' },
          { customerCode: 'C7', title: 'Title Fallback' },
          { customerCode: 'C9' },
        ],
      },
      {
        id: 'other',
        owner: { customerCode: 'C4', displayName: 'Lin CRM' },
        reviewers: [{ customerCode: 'C5', title: 'Other Reviewer' }],
      },
    ];
    const search = (keyword: string, resolved = relationSearchDefinition) =>
      applyLocalGridQuery(
        rows,
        {
          pagination: { type: 'offset', page: 1, pageSize: 20 },
          keyword,
          filters: createFilterGroup(),
          sorts: [],
        },
        resolved,
      );

    expect(search('ada crm').rows.map((row) => row.id)).toEqual(['matching']);
    expect(search('grace hopper').rows.map((row) => row.id)).toEqual(['matching']);
    expect(search('fallback name').rows.map((row) => row.id)).toEqual(['matching']);
    expect(search('label fallback').rows.map((row) => row.id)).toEqual(['matching']);
    expect(search('title fallback').rows.map((row) => row.id)).toEqual(['matching']);
    expect(search('c9').rows.map((row) => row.id)).toEqual(['matching']);

    const explicitSearchDefinition = resolveGridDefinition<RelationSearchRow>({
      id: 'relation-explicit-search',
      rowKey: 'id',
      fields: [
        {
          id: 'owner',
          title: 'Owner',
          relation: {
            target: 'crm.customer',
            cardinality: 'one',
            keyField: 'customerCode',
            labelField: 'displayName',
          },
          searchText: (_owner, row) => `account-${row.id}`,
        },
      ],
    });
    const explicitRows = [rows[0]!];
    const explicitSearch = (keyword: string) =>
      applyLocalGridQuery(
        explicitRows,
        {
          pagination: { type: 'offset', page: 1, pageSize: 20 },
          keyword,
          filters: createFilterGroup(),
          sorts: [],
        },
        explicitSearchDefinition,
      );

    expect(explicitSearch('account-matching').total).toEqual({ value: 1, accuracy: 'exact' });
    expect(explicitSearch('ada crm').total).toEqual({ value: 0, accuracy: 'exact' });
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

  it('enforces operator-specific filter value shapes', () => {
    const capabilities = resolveGridCapabilities(
      createRemoteSource<Row>(async () => ({ rows: [] }), {
        capabilities: { filter: { logic: 'nested', negation: true } },
      }),
    );
    const query = makeQuery();
    query.keyword = '';
    query.sorts = [];
    query.filters = createFilterGroup('and', [createFilterCondition('score', 'between', [1])]);
    expect(() => validateGridQuery(query, definition, capabilities)).toThrow('is incomplete');
    expect(() => compileGridQuery(query, definition)).toThrow('is incomplete');

    query.filters = createFilterGroup('and', [createFilterCondition('name', 'isEmpty', 'stale')]);
    expect(() => validateGridQuery(query, definition, capabilities)).toThrow(
      'does not accept a value',
    );
  });

  it('supports custom operator value kinds from value types and field overrides', () => {
    interface CustomRow {
      id: string;
      code: string;
      label: string;
    }
    const customDefinition = resolveGridDefinition<CustomRow>({
      id: 'custom-operator-kinds',
      rowKey: 'id',
      valueTypes: {
        code: {
          operators: ['isAssigned', 'oneOfCodes', 'codeRange'],
          operatorValueKinds: {
            isAssigned: 'none',
            oneOfCodes: 'multiple',
            codeRange: 'range',
          },
        },
      },
      fields: [
        { id: 'code', title: 'Code', valueType: 'code', filter: true },
        {
          id: 'label',
          title: 'Label',
          filter: {
            operators: ['matchesTokens'],
            operatorValueKinds: { matchesTokens: 'multiple' },
          },
        },
      ],
    });
    const capabilities = resolveGridCapabilities(
      createRemoteSource<CustomRow>(async () => ({ rows: [] })),
    );
    const customQuery = (condition: ReturnType<typeof createFilterCondition>): GridQuery => ({
      pagination: { type: 'offset', page: 1, pageSize: 20 },
      keyword: '',
      filters: createFilterGroup('and', [condition]),
      sorts: [],
    });

    const none = customQuery(createFilterCondition('code', 'isAssigned'));
    expect(() => validateGridQuery(none, customDefinition, capabilities)).not.toThrow();
    expect(compileGridQuery(none, customDefinition).filter).toEqual({
      logic: 'and',
      children: [{ field: 'code', operator: 'isAssigned' }],
    });
    none.filters.children[0] = createFilterCondition('code', 'isAssigned', true);
    expect(() => validateGridQuery(none, customDefinition, capabilities)).toThrow(
      'does not accept a value',
    );

    const multiple = customQuery(createFilterCondition('code', 'oneOfCodes', 'A'));
    expect(() => validateGridQuery(multiple, customDefinition, capabilities)).toThrow(
      'is incomplete',
    );
    multiple.filters.children[0] = createFilterCondition('code', 'oneOfCodes', ['A', 'B']);
    expect(() => validateGridQuery(multiple, customDefinition, capabilities)).not.toThrow();

    const range = customQuery(createFilterCondition('code', 'codeRange', ['A']));
    expect(() => validateGridQuery(range, customDefinition, capabilities)).toThrow('is incomplete');
    range.filters.children[0] = createFilterCondition('code', 'codeRange', ['A', 'Z']);
    expect(() => validateGridQuery(range, customDefinition, capabilities)).not.toThrow();

    const field = customDefinition.fieldMap.get('label')!;
    const missingMultiple = createFilterGroup('and', [
      createFilterCondition('label', 'matchesTokens'),
    ]);
    expect(
      pruneFilterGroup(missingMultiple, (condition) =>
        getFilterOperatorValueKind(
          condition.operator,
          field.filter ? field.filter.operatorValueKinds : undefined,
        ),
      ).children,
    ).toEqual([]);
    expect(field.filter && field.filter.operatorValueKinds?.matchesTokens).toBe('multiple');
  });

  it('prunes empty nested groups after deletion and before transport compilation', () => {
    const condition = createFilterCondition('name', 'contains', 'ada');
    const nested = createFilterGroup('or', [condition]);
    const filters = createFilterGroup('and', [nested]);
    expect(removeFilterNode(filters, condition.id).children).toEqual([]);

    const query = makeQuery();
    query.filters = createFilterGroup('and', [createFilterGroup('or')]);
    expect(compileGridQuery(query, definition).filter).toBeUndefined();

    query.filters = createFilterGroup('or');
    query.filters.negated = true;
    expect(() =>
      validateGridQuery(
        query,
        definition,
        resolveGridCapabilities(createRemoteSource<Row>(async () => ({ rows: [] }))),
      ),
    ).not.toThrow();
  });

  it('uses multiset semantics for array equality', () => {
    const field = definition.fieldMap.get('tags')!;
    const row: Row = { id: 1, profile: { name: 'Ada' }, score: 1, tags: ['a', 'b'] };
    expect(
      matchesGridCondition(row, field, createFilterCondition('tags', 'equals', ['a', 'a'])),
    ).toBe(false);
    expect(
      matchesGridCondition(row, field, createFilterCondition('tags', 'equals', ['b', 'a'])),
    ).toBe(true);
  });

  it('sorts and filters decimal strings without IEEE-754 precision loss', () => {
    interface DecimalRow {
      id: string;
      amount: string;
    }
    const decimalDefinition = resolveGridDefinition<DecimalRow>({
      id: 'decimal-query',
      rowKey: 'id',
      fields: [{ id: 'amount', title: 'Amount', valueType: 'decimal', filter: true, sort: true }],
    });
    const rows: DecimalRow[] = [
      { id: 'low', amount: '9007199254740992' },
      { id: 'high', amount: '9007199254740993' },
      { id: 'equal', amount: '9007199254740992.000' },
    ];
    const query: GridQuery = {
      pagination: { type: 'offset', page: 1, pageSize: 20 },
      keyword: '',
      filters: createFilterGroup('and', [
        createFilterCondition('amount', 'greaterThan', '9007199254740992'),
      ]),
      sorts: [{ id: 'amount', fieldId: 'amount', direction: 'asc' }],
    };
    expect(applyLocalGridQuery(rows, query, decimalDefinition).rows.map((row) => row.id)).toEqual([
      'high',
    ]);
    query.filters = createFilterGroup();
    expect(applyLocalGridQuery(rows, query, decimalDefinition).rows.map((row) => row.id)).toEqual([
      'low',
      'equal',
      'high',
    ]);

    const field = decimalDefinition.fieldMap.get('amount')!;
    expect(
      matchesGridCondition(
        rows[0]!,
        field,
        createFilterCondition('amount', 'equals', '9007199254740992.0'),
      ),
    ).toBe(true);
  });

  it('rejects non-finite, cyclic and non-plain JSON values', () => {
    expect(isGridJsonValue(Number.NaN)).toBe(false);
    expect(isGridJsonValue(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isGridJsonValue(new Date())).toBe(false);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(isGridJsonValue(cyclic)).toBe(false);

    const query = makeQuery();
    query.filters.children[0] = {
      ...query.filters.children[0]!,
      value: undefined,
    } as never;
    expect(serializeGridQuery(query)).not.toHaveProperty('filters.children.0.value');
    query.context = { invalid: Number.NaN };
    expect(() => serializeGridQuery(query)).toThrow('numbers must be finite');
  });

  it('adds row identity and declared transport dependencies to projections', () => {
    const projected = resolveGridDefinition<Row>({
      id: 'projection-test',
      rowKey: (row) => row.id,
      projection: {
        rowKey: 'record_id',
        requiredFields: ['score'],
        requiredKeys: ['permissions'],
      },
      fields: [
        {
          id: 'name',
          title: 'Name',
          transport: { selectKey: 'display_name', selectDependencies: ['profile'] },
        },
        { id: 'score', title: 'Score', transport: { selectKey: 'ranking' } },
      ],
    });
    const query: GridQuery = {
      pagination: { type: 'offset', page: 1, pageSize: 20 },
      keyword: '',
      filters: createFilterGroup(),
      sorts: [],
      projection: ['name'],
    };
    expect(compileGridQuery(query, projected).select).toEqual([
      'record_id',
      'permissions',
      'display_name',
      'profile',
      'ranking',
    ]);

    const missingRowKey = resolveGridDefinition<Row>({
      id: 'projection-missing-row-key',
      rowKey: (row) => row.id,
      fields: [{ id: 'name', title: 'Name' }],
    });
    expect(() => compileGridQuery(query, missingRowKey)).toThrow(
      'functional rowKey requires definition.projection.rowKey',
    );
  });

  it('uses declared option/entity identity instead of labels or object references', () => {
    interface RelationRow {
      id: string;
      owner: { id: number; label: string };
      reviewers: Array<{ id: number; label: string }>;
    }
    const relationDefinition = resolveGridDefinition<RelationRow>({
      id: 'entity-identity',
      rowKey: 'id',
      fields: [
        { id: 'owner', title: 'Owner', valueType: 'relation', filter: true },
        { id: 'reviewers', title: 'Reviewers', valueType: 'user', filter: true },
      ],
    });
    const row: RelationRow = {
      id: 'one',
      owner: { id: 7, label: 'Old label' },
      reviewers: [{ id: 8, label: 'Ada' }],
    };

    expect(
      matchesGridCondition(
        row,
        relationDefinition.fieldMap.get('owner')!,
        createFilterCondition('owner', 'in', [7]),
      ),
    ).toBe(true);
    expect(
      matchesGridCondition(
        row,
        relationDefinition.fieldMap.get('reviewers')!,
        createFilterCondition('reviewers', 'containsAny', [{ id: 8, label: 'Renamed' }]),
      ),
    ).toBe(true);
    expect(
      matchesGridCondition(
        row,
        relationDefinition.fieldMap.get('owner')!,
        createFilterCondition('owner', 'equals', { id: 9, label: 'Old label' }),
      ),
    ).toBe(false);

    const customIdentityDefinition = resolveGridDefinition<{
      id: string;
      owner: { customerCode: string; label: string };
    }>({
      id: 'custom-entity-identity',
      rowKey: 'id',
      fields: [
        {
          id: 'owner',
          title: 'Owner',
          valueType: 'relation',
          filter: true,
          getIdentity: (entity) => entity.customerCode,
        },
      ],
    });
    expect(
      matchesGridCondition(
        { id: 'one', owner: { customerCode: 'customer-7', label: 'Ada' } },
        customIdentityDefinition.fieldMap.get('owner')!,
        createFilterCondition('owner', 'equals', {
          customerCode: 'customer-7',
          label: 'Renamed',
        }),
      ),
    ).toBe(true);
    expect(
      matchesGridCondition(
        { id: 'one', owner: { customerCode: 'customer-7', label: 'Ada' } },
        customIdentityDefinition.fieldMap.get('owner')!,
        createFilterCondition('owner', 'equals', 'customer-7'),
      ),
    ).toBe(true);

    const relationMetadataDefinition = resolveGridDefinition<{
      id: string;
      owner: { customerCode: string; displayName: string };
    }>({
      id: 'relation-metadata-identity',
      rowKey: 'id',
      fields: [
        {
          id: 'owner',
          title: 'Owner',
          relation: {
            target: 'crm.customer',
            cardinality: 'one',
            keyField: 'customerCode',
            labelField: 'displayName',
          },
          filter: true,
        },
      ],
    });
    expect(
      matchesGridCondition(
        { id: 'one', owner: { customerCode: 'customer-8', displayName: 'Grace' } },
        relationMetadataDefinition.fieldMap.get('owner')!,
        createFilterCondition('owner', 'equals', 'customer-8'),
      ),
    ).toBe(true);
  });

  it('evaluates relative dates with an explicit timezone, week start and clock', () => {
    interface DateRow {
      id: string;
      occurredAt: string;
    }
    const dateDefinition = resolveGridDefinition<DateRow>({
      id: 'temporal-query',
      rowKey: 'id',
      fields: [{ id: 'occurredAt', title: 'Occurred', valueType: 'dateTime', filter: true }],
    });
    const field = dateDefinition.fieldMap.get('occurredAt')!;
    const clock = () => new Date('2026-08-24T00:30:00.000Z');
    const nextLocalDay: DateRow = { id: 'next', occurredAt: '2026-08-24T08:00:00.000Z' };

    expect(
      matchesGridCondition(nextLocalDay, field, createFilterCondition('occurredAt', 'today'), {
        timeZone: 'America/Los_Angeles',
        now: clock,
      }),
    ).toBe(false);
    expect(
      matchesGridCondition(nextLocalDay, field, createFilterCondition('occurredAt', 'tomorrow'), {
        timeZone: 'America/Los_Angeles',
        now: clock,
      }),
    ).toBe(true);

    const sunday: DateRow = { id: 'sunday', occurredAt: '2026-08-23' };
    expect(
      matchesGridCondition(sunday, field, createFilterCondition('occurredAt', 'lastWeek'), {
        timeZone: 'UTC',
        weekStartsOn: 1,
        now: clock,
      }),
    ).toBe(true);
    expect(
      matchesGridCondition(sunday, field, createFilterCondition('occurredAt', 'thisWeek'), {
        timeZone: 'UTC',
        weekStartsOn: 0,
        now: clock,
      }),
    ).toBe(true);

    const offsetless: DateRow = { id: 'offsetless', occurredAt: '2026-08-24T10:00:00' };
    expect(
      matchesGridCondition(
        offsetless,
        field,
        createFilterCondition('occurredAt', 'onOrAfter', '2026-08-24T10:00:00Z'),
      ),
    ).toBe(true);
    expect(
      matchesGridCondition(
        offsetless,
        field,
        createFilterCondition('occurredAt', 'onOrBefore', '2026-08-24T10:00:00Z'),
      ),
    ).toBe(true);

    expect(() =>
      matchesGridCondition(sunday, field, createFilterCondition('occurredAt', 'today'), {
        timeZone: 'Not/A_Timezone',
        now: clock,
      }),
    ).toThrow('timeZone');
  });

  it('validates all local row keys before paging and preserves empty custom search text', () => {
    interface FlexibleRow {
      id: string | number;
      name: string;
    }
    const localDefinition = resolveGridDefinition<FlexibleRow>({
      id: 'local-integrity',
      rowKey: 'id',
      fields: [
        {
          id: 'name',
          title: 'Name',
          searchText: () => '',
        },
      ],
    });
    const query: GridQuery = {
      pagination: { type: 'offset', page: 1, pageSize: 1 },
      keyword: 'hidden',
      filters: createFilterGroup(),
      sorts: [],
    };
    expect(() =>
      applyLocalGridQuery(
        [
          { id: 1, name: 'hidden' },
          { id: '1', name: 'hidden' },
        ],
        query,
        localDefinition,
      ),
    ).toThrow('row keys must be unique');

    expect(applyLocalGridQuery([{ id: 1, name: 'hidden' }], query, localDefinition).rows).toEqual(
      [],
    );
  });

  it('rejects malformed cursor state and duplicate semantic ids at runtime', () => {
    const capabilities = resolveGridCapabilities(
      createRemoteSource<Row>(async () => ({ rows: [] }), {
        capabilities: { pagination: 'cursor', sort: { max: 3 } },
      }),
    );
    const query: GridQuery = {
      pagination: { type: 'cursor', pageSize: 20, cursor: '' },
      keyword: '',
      filters: createFilterGroup(),
      sorts: [],
    };
    expect(() => validateGridQuery(query, definition, capabilities)).toThrow('Cursor pagination');

    query.pagination = { type: 'cursor', pageSize: 20 };
    query.filters.children = [
      { ...createFilterCondition('name', 'contains', 'a'), id: 'duplicate' },
      { ...createFilterCondition('score', 'equals', 1), id: 'duplicate' },
    ];
    expect(() => validateGridQuery(query, definition, capabilities)).toThrow('filter ids');
  });
});
