import {
  applyLocalGridQuery,
  createFilterGroup,
  type GridFilterCondition,
  type GridFilterGroup,
  type GridQuery,
  type GridReadResult,
  type GridRequestFilterCondition,
  type GridRequestFilterGroup,
  type GridRequestQuery,
  type GridResolvedDefinition,
  type GridSort,
} from '@stevenleep/data-grid';
import type { DemoOrder } from './data';

type RequestFilterNode = GridRequestFilterGroup | GridRequestFilterCondition;
type QueryFilterNode = GridFilterGroup | GridFilterCondition;

function isRequestGroup(node: RequestFilterNode): node is GridRequestFilterGroup {
  return 'children' in node;
}

function requestToQuery(
  request: GridRequestQuery,
  definition: GridResolvedDefinition<DemoOrder>,
): GridQuery {
  if (request.pagination.type !== 'offset') {
    throw new Error('The demo order endpoint only accepts offset pagination.');
  }

  const filterFields = new Map(
    definition.fields.map((field) => [field.transport.filterKey, field.id]),
  );
  const sortFields = new Map(definition.fields.map((field) => [field.transport.sortKey, field.id]));
  let nodeId = 0;
  const nextId = (kind: 'group' | 'condition') => `mock-api-${kind}-${++nodeId}`;

  const mapFilter = (node: RequestFilterNode): QueryFilterNode => {
    if (isRequestGroup(node)) {
      return {
        id: nextId('group'),
        type: 'group',
        logic: node.logic,
        ...(node.negated ? { negated: true } : {}),
        children: node.children.map(mapFilter),
      };
    }
    const fieldId = filterFields.get(node.field);
    if (!fieldId) throw new Error(`The demo API does not recognize filter field "${node.field}".`);
    return {
      id: nextId('condition'),
      type: 'condition',
      fieldId,
      operator: node.operator,
      ...(node.value === undefined ? {} : { value: node.value }),
    };
  };

  const sorts: GridSort[] = (request.sort || []).map((sort, index) => {
    const fieldId = sortFields.get(sort.field);
    if (!fieldId) throw new Error(`The demo API does not recognize sort field "${sort.field}".`);
    return {
      id: `mock-api-sort-${index + 1}`,
      fieldId,
      direction: sort.direction,
      ...(sort.nulls ? { nulls: sort.nulls } : {}),
    };
  });

  return {
    pagination: request.pagination,
    keyword: request.keyword || '',
    filters: request.filter ? (mapFilter(request.filter) as GridFilterGroup) : createFilterGroup(),
    sorts,
    ...(request.context ? { context: request.context } : {}),
  };
}

/** Simulates the server boundary by accepting only the compiled transport protocol. */
export function executeOrderRequest(
  rows: readonly DemoOrder[],
  request: GridRequestQuery,
  definition: GridResolvedDefinition<DemoOrder>,
): GridReadResult<DemoOrder> {
  const query = requestToQuery(request, definition);
  const result = applyLocalGridQuery(rows, query, definition);
  if (request.select) {
    const acceptedSelectKeys = new Set<string>(['id']);
    definition.fields.forEach((field) => {
      acceptedSelectKeys.add(field.transport.selectKey);
      field.transport.selectDependencies?.forEach((key) => acceptedSelectKeys.add(key));
    });
    request.select.forEach((key) => {
      if (!acceptedSelectKeys.has(key)) {
        throw new Error(`The demo API does not recognize select field "${key}".`);
      }
    });
  }
  return {
    ...result,
    // GridReadResult<DemoOrder> promises materialized DemoOrder rows. A real
    // adapter may fetch a sparse DTO using request.select, but it must map that
    // DTO back to the declared row model before crossing the Grid boundary.
    rows: result.rows,
    summary: [
      {
        id: 'pageAmount',
        label: '本页金额',
        value: result.rows.reduce((total, row) => total + row.amount, 0).toFixed(2),
        fieldId: 'amount',
        aggregate: 'sum',
        scope: 'page',
      },
    ],
  };
}

function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/** Produces a real UTF-8 CSV download and protects spreadsheet formula cells. */
export function downloadOrdersCsv(rows: readonly DemoOrder[], filename: string): void {
  const header = ['订单号', '客户', '金额', '状态', '风险', '负责人', '标签', '支付', '创建时间'];
  const body = rows.map((row) => [
    row.orderNo,
    row.customer.name,
    row.amount,
    row.status,
    row.risk,
    row.owner.name,
    row.tags.join('|'),
    row.paid ? '是' : '否',
    row.createdAt,
  ]);
  const csv = `\uFEFF${[header, ...body].map((line) => line.map(csvCell).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
