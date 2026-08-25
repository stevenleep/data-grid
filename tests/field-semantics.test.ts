import { describe, expect, it } from 'vitest';
import {
  applyLocalGridQuery,
  bindGridSchema,
  compileGridQuery,
  createFilterGroup,
  getGridFieldDependencies,
  parseGridSchema,
  resolveGridDefinition,
  type GridFilterOperator,
  type GridJsonValue,
  type GridQuery,
} from '../src/core';

interface Row {
  id: string;
  name: string;
  privateNote: string;
  customer: { id: string; name: string };
  subtotal: number;
  tax: number;
  total: number;
  customerRegion: string;
  customerOrderCount: number;
}

function query(projection?: string[], keyword = ''): GridQuery {
  return {
    pagination: { type: 'offset', page: 1, pageSize: 20 },
    keyword,
    filters: createFilterGroup(),
    sorts: [],
    projection,
  };
}

describe('field capabilities and derivation semantics', () => {
  it('normalizes field-local capabilities while preserving existing feature declarations', () => {
    const definition = resolveGridDefinition<Row>({
      id: 'field-capabilities',
      rowKey: 'id',
      fields: [
        { id: 'name', title: 'Name', sort: true },
        { id: 'privateNote', title: 'Private note', search: false, filter: true },
        {
          id: 'customer',
          title: 'Customer',
          relation: {
            target: 'customers',
            cardinality: 'one',
            keyField: 'id',
            labelField: 'name',
          },
          filter: true,
          edit: true,
        },
        {
          id: 'reviewers',
          title: 'Reviewers',
          relation: { target: 'users', cardinality: 'many' },
          filter: true,
          edit: true,
        },
      ],
    });

    expect(definition.fieldMap.get('name')?.capabilities).toEqual({
      search: true,
      filter: false,
      sort: true,
      edit: false,
    });
    expect(definition.fieldMap.get('privateNote')?.capabilities).toEqual({
      search: false,
      filter: true,
      sort: false,
      edit: false,
    });
    const customer = definition.fieldMap.get('customer')!;
    expect(customer.valueType).toBe('relation');
    expect(customer.filter && customer.filter.operators).toEqual([
      'in',
      'notIn',
      'isEmpty',
      'isNotEmpty',
    ]);
    expect(customer.edit && customer.edit.multiple).toBe(false);
    expect(customer.capabilities.edit).toBe(true);
    expect(Object.isFrozen(customer.relation)).toBe(true);
    const reviewers = definition.fieldMap.get('reviewers')!;
    expect(reviewers.filter && reviewers.filter.operators).toEqual([
      'containsAny',
      'containsAll',
      'containsNone',
      'isEmpty',
      'isNotEmpty',
    ]);
    expect(reviewers.edit && reviewers.edit.multiple).toBe(true);
  });

  it('keeps source-bound formula, lookup and rollup values materialized with dependency metadata', () => {
    const definition = resolveGridDefinition<Row>({
      id: 'derived-fields',
      rowKey: 'id',
      fields: [
        {
          id: 'customer',
          title: 'Customer',
          valueType: 'relation',
          relation: { target: 'customers', cardinality: 'one' },
          transport: { selectKey: 'customer_record' },
        },
        {
          id: 'subtotal',
          title: 'Subtotal',
          valueType: 'money',
          transport: { selectKey: 'subtotal_cents' },
        },
        {
          id: 'tax',
          title: 'Tax',
          valueType: 'money',
          transport: { selectKey: 'tax_cents' },
        },
        {
          id: 'total',
          title: 'Total',
          valueType: 'money',
          derivation: {
            kind: 'formula',
            dependencies: ['subtotal', 'tax'],
            expression: 'subtotal + tax',
          },
          transport: { selectKey: 'total_cents' },
        },
        {
          id: 'customerRegion',
          title: 'Customer region',
          derivation: {
            kind: 'lookup',
            relationField: 'customer',
            targetField: 'region',
          },
          transport: { selectKey: 'customer_region' },
        },
        {
          id: 'customerOrderCount',
          title: 'Customer orders',
          valueType: 'number',
          derivation: {
            kind: 'rollup',
            relationField: 'customer',
            aggregate: 'count',
          },
          transport: { selectKey: 'customer_order_count' },
        },
      ],
    });

    const row: Row = {
      id: 'order-1',
      name: 'Order',
      privateNote: '',
      customer: { id: 'customer-1', name: 'Ada' },
      subtotal: 100,
      tax: 20,
      total: 999,
      customerRegion: 'East',
      customerOrderCount: 7,
    };
    const total = definition.fieldMap.get('total')!;
    expect(total.getValue(row)).toBe(999);
    expect(total.derivation).toMatchObject({
      kind: 'formula',
      dependencies: ['subtotal', 'tax'],
      binding: 'source',
    });
    expect(total.capabilities.edit).toBe(false);
    expect(definition.fieldMap.get('customerRegion')?.derivation?.dependencies).toEqual([
      'customer',
    ]);
    expect(definition.fieldMap.get('customerOrderCount')?.derivation?.dependencies).toEqual([
      'customer',
    ]);
    expect(
      compileGridQuery(query(['total', 'customerRegion', 'customerOrderCount']), definition).select,
    ).toEqual(['id', 'total_cents', 'customer_region', 'customer_order_count']);
  });

  it('uses an explicit trusted accessor for runtime-bound derivations without evaluating metadata', () => {
    const schema = parseGridSchema({
      protocol: 'huiyun.data-grid/v1',
      id: 'runtime-derived-schema',
      revision: 1,
      fields: [
        { id: 'subtotal', title: 'Subtotal', valueType: 'money' },
        { id: 'tax', title: 'Tax', valueType: 'money' },
        {
          id: 'total',
          title: 'Total',
          valueType: 'money',
          derivation: {
            kind: 'formula',
            dependencies: ['subtotal', 'tax'],
            expression: 'opaque server syntax()',
            binding: 'runtime',
          },
        },
      ],
    });
    const definition = resolveGridDefinition(
      bindGridSchema<Row>(
        schema,
        { fields: { total: { accessor: (row) => row.subtotal + row.tax } } },
        'id',
      ),
    );
    const row = {
      id: 'one',
      name: '',
      privateNote: '',
      customer: { id: 'customer-1', name: 'Ada' },
      subtotal: 100,
      tax: 20,
      total: 999,
      customerRegion: '',
      customerOrderCount: 0,
    };

    expect(definition.fieldMap.get('total')?.getValue(row)).toBe(120);
    const derivation = definition.fieldMap.get('total')?.derivation;
    expect(derivation?.kind).toBe('formula');
    if (derivation?.kind !== 'formula') throw new Error('Expected formula derivation.');
    expect(derivation.expression).toBe('opaque server syntax()');
    expect(compileGridQuery(query(['total']), definition).select).toEqual([
      'id',
      'subtotal',
      'tax',
    ]);
  });

  it('excludes fields that opt out of local keyword search', () => {
    const definition = resolveGridDefinition<Row>({
      id: 'search-capability',
      rowKey: 'id',
      fields: [
        { id: 'name', title: 'Name' },
        { id: 'privateNote', title: 'Private note', search: false },
      ],
    });
    const rows = [
      {
        id: 'one',
        name: 'Visible',
        privateNote: 'needle',
        customer: { id: 'customer-1', name: 'Ada' },
        subtotal: 0,
        tax: 0,
        total: 0,
        customerRegion: '',
        customerOrderCount: 0,
      },
    ];

    expect(applyLocalGridQuery(rows, query(undefined, 'needle'), definition).rows).toEqual([]);
    expect(applyLocalGridQuery(rows, query(undefined, 'visible'), definition).rows).toEqual(rows);
  });

  it('rejects invalid or cyclic semantic dependency graphs before execution', () => {
    expect(() =>
      resolveGridDefinition<Row>({
        id: 'missing-dependency',
        rowKey: 'id',
        fields: [
          {
            id: 'total',
            title: 'Total',
            derivation: { kind: 'formula', dependencies: ['missing'] },
          },
        ],
      }),
    ).toThrow('depends on unknown field');

    expect(() =>
      resolveGridDefinition<Row>({
        id: 'cyclic-dependency',
        rowKey: 'id',
        fields: [
          { id: 'left', title: 'Left', derivation: { kind: 'formula', dependencies: ['right'] } },
          { id: 'right', title: 'Right', derivation: { kind: 'formula', dependencies: ['left'] } },
        ],
      }),
    ).toThrow('dependency cycle');

    expect(() =>
      parseGridSchema({
        protocol: 'huiyun.data-grid/v1',
        id: 'bad-lookup',
        revision: 1,
        fields: [
          { id: 'customer', title: 'Customer' },
          {
            id: 'region',
            title: 'Region',
            derivation: {
              kind: 'lookup',
              relationField: 'customer',
              targetField: 'region',
            },
          },
        ],
      }),
    ).toThrow('requires relation field');

    expect(() =>
      resolveGridDefinition<Row>({
        id: 'missing-runtime-binding',
        rowKey: 'id',
        fields: [
          {
            id: 'total',
            title: 'Total',
            derivation: { kind: 'formula', dependencies: [], binding: 'runtime' },
          },
        ],
      }),
    ).toThrow('requires an accessor');

    expect(() =>
      resolveGridDefinition<Row>({
        id: 'formula-is-not-a-value-type',
        rowKey: 'id',
        fields: [{ id: 'total', title: 'Total', valueType: 'formula' }],
      }),
    ).toThrow('Unknown value type "formula"');

    expect(() =>
      parseGridSchema({
        protocol: 'huiyun.data-grid/v1',
        id: 'unknown-derivation-kind',
        revision: 1,
        fields: [
          {
            id: 'total',
            title: 'Total',
            derivation: { kind: 'script', dependencies: [] },
          },
        ],
      }),
    ).toThrow('kind must be formula, lookup or rollup');
  });

  it('exposes a small dependency helper without interpreting derivation expressions', () => {
    expect(
      getGridFieldDependencies({
        kind: 'lookup',
        relationField: 'customer',
        targetField: 'region',
        dependencies: ['locale', 'customer'],
      }),
    ).toEqual(['customer', 'locale']);
  });
});

describe('built-in temporal value semantics', () => {
  interface TemporalRow {
    id: string;
    businessDate: unknown;
    occurredAt: unknown;
    ordinaryNumber: number;
  }

  const definition = resolveGridDefinition<TemporalRow>({
    id: 'temporal-value-semantics',
    rowKey: 'id',
    fields: [
      { id: 'businessDate', title: 'Business date', valueType: 'date', filter: true, sort: true },
      { id: 'occurredAt', title: 'Occurred at', valueType: 'dateTime', filter: true, sort: true },
      { id: 'ordinaryNumber', title: 'Ordinary number', valueType: 'number', filter: true },
    ],
  });

  const filtered = (
    rows: TemporalRow[],
    fieldId: string,
    operator: GridFilterOperator,
    value: GridJsonValue | undefined,
    timeZone?: string,
  ) => {
    const candidate = query();
    candidate.filters = createFilterGroup('and', [
      {
        id: 'condition',
        type: 'condition',
        fieldId,
        operator,
        value,
      },
    ]);
    return applyLocalGridQuery(rows, candidate, definition, timeZone ? { timeZone } : undefined)
      .rows;
  };

  it('normalizes dateTime Date, millisecond timestamp and ISO strings to one instant', () => {
    const field = definition.fieldMap.get('occurredAt')!;
    const instant = Date.parse('2026-08-25T02:30:00.125Z');

    expect(field.equals(new Date(instant), instant)).toBe(true);
    expect(field.equals(instant, '2026-08-25T10:30:00.125+08:00')).toBe(true);
    expect(field.equals('2026-08-25T02:30:00.125', '2026-08-25T02:30:00.125Z')).toBe(true);
    expect(field.equals('2026-08-25', '2026-08-25T00:00:00Z')).toBe(true);
    expect(
      field.compare?.(
        new Date(instant),
        '2026-08-25T02:30:01Z',
        {} as TemporalRow,
        {} as TemporalRow,
      ),
    ).toBeLessThan(0);

    expect(field.equals('2026-02-30T00:00:00Z', '2026-03-02T00:00:00Z')).toBe(false);
    expect(field.equals('08/25/2026', '2026-08-25T00:00:00Z')).toBe(false);
  });

  it('treats date as a calendar day and applies the query timezone to instant-like values', () => {
    const rows: TemporalRow[] = [
      {
        id: 'instant',
        businessDate: new Date('2026-08-24T23:30:00Z'),
        occurredAt: '',
        ordinaryNumber: 0,
      },
      {
        id: 'logical-date',
        businessDate: '2026-08-25',
        occurredAt: '',
        ordinaryNumber: 0,
      },
    ];

    expect(
      filtered(rows, 'businessDate', 'equals', '2026-08-25', 'UTC').map(({ id }) => id),
    ).toEqual(['logical-date']);
    expect(
      filtered(rows, 'businessDate', 'equals', '2026-08-25', 'Asia/Shanghai').map(({ id }) => id),
    ).toEqual(['instant', 'logical-date']);

    const localSort = query();
    localSort.sorts = [{ id: 'date-sort', fieldId: 'businessDate', direction: 'asc' }];
    const sorted = applyLocalGridQuery(
      [rows[0]!, rows[1]!, { ...rows[0]!, id: 'previous', businessDate: '2026-08-24' }],
      localSort,
      definition,
      { timeZone: 'Asia/Shanghai' },
    );
    expect(sorted.rows.map(({ id }) => id)).toEqual(['previous', 'instant', 'logical-date']);
  });

  it('uses canonical temporal comparison in local filters and stable sorting', () => {
    const instant = Date.parse('2026-08-25T02:30:00Z');
    const rows: TemporalRow[] = [
      { id: 'date', businessDate: '', occurredAt: new Date(instant), ordinaryNumber: instant },
      { id: 'milliseconds', businessDate: '', occurredAt: instant, ordinaryNumber: instant },
      {
        id: 'offset',
        businessDate: '',
        occurredAt: '2026-08-25T10:30:00+08:00',
        ordinaryNumber: instant,
      },
      {
        id: 'earlier',
        businessDate: '',
        occurredAt: '2026-08-25T02:29:59Z',
        ordinaryNumber: instant,
      },
      { id: 'invalid', businessDate: '', occurredAt: 'not-a-date', ordinaryNumber: instant },
    ];

    expect(
      filtered(rows, 'occurredAt', 'equals', '2026-08-25T02:30:00').map(({ id }) => id),
    ).toEqual(['date', 'milliseconds', 'offset']);
    expect(
      filtered(rows, 'occurredAt', 'between', ['2026-08-25T02:29:59Z', '2026-08-25T02:30:00Z']).map(
        ({ id }) => id,
      ),
    ).toEqual(['date', 'milliseconds', 'offset', 'earlier']);
    expect(
      filtered(rows, 'occurredAt', 'notBetween', [
        '2026-08-25T02:30:00Z',
        '2026-08-25T02:30:00Z',
      ]).map(({ id }) => id),
    ).toEqual(['earlier']);

    const localSort = query();
    localSort.sorts = [{ id: 'instant-sort', fieldId: 'occurredAt', direction: 'asc' }];
    expect(
      applyLocalGridQuery(rows.slice(0, 4), localSort, definition).rows.map(({ id }) => id),
    ).toEqual(['earlier', 'date', 'milliseconds', 'offset']);
  });

  it('does not interpret an ordinary number field as a date', () => {
    const instant = Date.parse('2026-08-25T02:30:00Z');
    const row: TemporalRow = {
      id: 'number',
      businessDate: '',
      occurredAt: '',
      ordinaryNumber: instant,
    };

    expect(filtered([row], 'ordinaryNumber', 'equals', '2026-08-25T02:30:00Z')).toEqual([]);
    expect(filtered([row], 'ordinaryNumber', 'today', undefined, 'UTC')).toEqual([]);
  });

  it('keeps explicit field-level temporal equality and ordering overrides authoritative', () => {
    const custom = resolveGridDefinition<TemporalRow>({
      id: 'custom-temporal-semantics',
      rowKey: 'id',
      fields: [
        {
          id: 'businessDate',
          title: 'Custom date',
          valueType: 'date',
          filter: true,
          sort: true,
          equals: () => true,
          compare: () => 0,
        },
      ],
    });
    const row: TemporalRow = {
      id: 'custom',
      businessDate: 'not-a-date',
      occurredAt: '',
      ordinaryNumber: 0,
    };
    const candidate = query();
    candidate.filters = createFilterGroup('and', [
      {
        id: 'custom-condition',
        type: 'condition',
        fieldId: 'businessDate',
        operator: 'equals',
        value: 'anything',
      },
    ]);
    expect(applyLocalGridQuery([row], candidate, custom).rows).toEqual([row]);
  });
});
