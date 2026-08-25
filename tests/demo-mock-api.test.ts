import { describe, expect, it } from 'vitest';
import { createFieldHelper, defineGrid, resolveGridDefinition } from '../src/core';
import { createDemoOrders, type DemoOrder } from '../examples/demo/src/data';
import { executeOrderRequest } from '../examples/demo/src/mockOrderApi';

const field = createFieldHelper<DemoOrder>();
const definition = resolveGridDefinition(
  defineGrid<DemoOrder>({
    id: 'demo-api-test',
    rowKey: 'id',
    fields: [
      field.property('orderNo', { title: 'Order', filter: true, sort: true }),
      field.property('customer', {
        title: 'Customer',
        valueType: 'relation',
        filter: true,
        transport: { filterKey: 'customer_id' },
      }),
      field.property('amount', {
        title: 'Amount',
        valueType: 'money',
        sort: true,
      }),
    ],
  }),
);

describe('demo mock order API', () => {
  it('executes compiled transport fields instead of bypassing the wire request', () => {
    const rows = createDemoOrders(16);
    const result = executeOrderRequest(
      rows,
      {
        pagination: { type: 'offset', page: 1, pageSize: 5 },
        filter: {
          logic: 'and',
          children: [{ field: 'customer_id', operator: 'in', value: [1] }],
        },
        sort: [{ field: 'amount', direction: 'desc' }],
        select: ['id', 'orderNo'],
      },
      definition,
    );

    expect(result.total).toEqual({ value: 2, accuracy: 'exact' });
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((row) => row.customer.id === 1)).toBe(true);
    expect(result.rows[0]!.amount).toBeGreaterThanOrEqual(result.rows[1]!.amount);
    expect(result.rows.every((row) => row.orderNo && row.customer && row.owner)).toBe(true);
    expect(result.summary?.[0]?.value).toMatch(/^\d+\.\d{2}$/);
  });

  it('rejects unknown transport keys so protocol drift is visible in the demo', () => {
    expect(() =>
      executeOrderRequest(
        createDemoOrders(4),
        {
          pagination: { type: 'offset', page: 1, pageSize: 4 },
          filter: {
            logic: 'and',
            children: [{ field: 'wrong_customer_key', operator: 'equals', value: 1 }],
          },
        },
        definition,
      ),
    ).toThrow('does not recognize filter field');
  });
});
