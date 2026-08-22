import { describe, expect, it } from 'vitest';
import {
  bindGridSchema,
  createFieldHelper,
  defineGrid,
  defineGridRuntime,
  defineGridSchema,
  resolveGridDefinition,
} from '../src/core';

interface OrderRow {
  id: string;
  customer: { name: string };
  amountInCents: number;
}

describe('grid definition', () => {
  it('keeps semantic fields independent from grouped presentation columns', () => {
    const field = createFieldHelper<OrderRow>();
    const definition = resolveGridDefinition(
      defineGrid<OrderRow>({
        id: 'orders',
        revision: 2,
        rowKey: 'id',
        fields: [
          field.path('customerName', ['customer', 'name'], {
            title: 'Customer',
            filter: true,
            sort: true,
          }),
          field.accessor('amount', (row) => row.amountInCents / 100, {
            title: 'Amount',
            valueType: 'money',
            transport: { filterKey: 'amount_cents' },
          }),
        ],
        columns: [
          {
            id: 'details',
            title: 'Details',
            children: [
              { id: 'customer', fieldId: 'customerName' },
              { id: 'total', fieldId: 'amount', width: 180 },
            ],
          },
        ],
      }),
    );

    const row = { id: 'a', customer: { name: 'Ada' }, amountInCents: 1234 };
    expect(definition.getRowKey(row)).toBe('a');
    expect(definition.fieldMap.get('customerName')?.getValue(row)).toBe('Ada');
    expect(definition.fieldMap.get('amount')?.getValue(row)).toBe(12.34);
    expect(definition.columns[0]?.children?.map((column) => column.id)).toEqual([
      'customer',
      'total',
    ]);
    expect(definition.columnMap.get('total')?.width).toBe(180);
  });

  it('rejects duplicate ids and unknown field references early', () => {
    expect(() =>
      resolveGridDefinition({
        id: 'duplicate-fields',
        rowKey: 'id',
        fields: [
          { id: 'name', title: 'Name' },
          { id: 'name', title: 'Other name' },
        ],
      }),
    ).toThrow('Duplicate grid field id');

    expect(() =>
      resolveGridDefinition({
        id: 'unknown-column-field',
        rowKey: 'id',
        fields: [{ id: 'name', title: 'Name' }],
        columns: [{ id: 'missing', fieldId: 'missing' }],
      }),
    ).toThrow('references unknown field');
  });

  it('binds a serializable protocol schema to runtime-only behavior', () => {
    const schema = defineGridSchema({
      protocol: 'huiyun.data-grid/v1',
      id: 'remote-orders',
      revision: '2026-08',
      fields: [
        {
          id: 'amount',
          title: 'Amount',
          valueType: 'money',
          path: ['amountInCents'],
          transport: { filterKey: 'amount_cents' },
          filter: true,
          renderer: 'amount',
        },
      ],
      actions: [{ id: 'export', label: 'Export', handler: 'exportOrders' }],
    });
    const runtime = defineGridRuntime<OrderRow>({
      fields: {
        amount: { normalize: (value) => Number(value) / 100 },
      },
      renderers: {
        amount: ({ value }) => `CNY ${String(value)}`,
      },
      actionHandlers: {
        exportOrders: () => undefined,
      },
    });
    const definition = resolveGridDefinition(bindGridSchema(schema, runtime, 'id'));
    const row = { id: 'a', customer: { name: 'Ada' }, amountInCents: 1234 };

    expect(definition.fieldMap.get('amount')?.getValue(row)).toBe(12.34);
    expect(definition.fieldMap.get('amount')?.transport.filterKey).toBe('amount_cents');
    expect(definition.actions?.[0]?.id).toBe('export');
  });

  it('fails fast when a schema references missing runtime behavior', () => {
    const schema = defineGridSchema({
      protocol: 'huiyun.data-grid/v1',
      id: 'invalid-runtime',
      revision: 1,
      fields: [{ id: 'name', title: 'Name', renderer: 'missingRenderer' }],
    });
    expect(() => bindGridSchema<OrderRow>(schema, {}, 'id')).toThrow(
      'Missing renderer "missingRenderer"',
    );
  });
});
