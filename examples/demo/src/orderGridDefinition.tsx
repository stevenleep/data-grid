import {
  CheckCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useMemo, type Dispatch, type SetStateAction } from 'react';
import {
  applyLocalGridQuery,
  createFieldHelper,
  defineGrid,
  resolveGridDefinition,
  type GridDefinition,
  type GridFilterCondition,
  type GridQuery,
  type GridRequestQuery,
  type GridResolvedDefinition,
  type GridSelectionState,
} from '@huiyun/data-grid';
import { demoCustomers, demoOwners, demoTags, waitForServer, type DemoOrder } from './data';
import { downloadOrdersCsv, executeOrderRequest } from './mockOrderApi';

export const statusOptions = [
  { label: '待处理', value: 'pending', color: 'gold' },
  { label: '处理中', value: 'processing', color: 'blue' },
  { label: '已完成', value: 'completed', color: 'green' },
  { label: '已取消', value: 'cancelled', color: 'default' },
];

export const riskOptions = [
  { label: '低风险', value: 'low', color: 'green' },
  { label: '中风险', value: 'medium', color: 'gold' },
  { label: '高风险', value: 'high', color: 'red' },
];

export const ownerOptions = demoOwners.map(({ id, name }) => ({ label: name, value: id }));
export const customerOptions = demoCustomers.map(({ id, name }) => ({ label: name, value: id }));
export const tagOptions = demoTags.map((value) => ({ label: value, value }));

const orderField = createFieldHelper<DemoOrder>();

function matchEntityId(
  value: { id: string | number } | null | undefined,
  condition: GridFilterCondition,
): boolean | undefined {
  if (condition.operator === 'isEmpty' || condition.operator === 'isNotEmpty') return undefined;
  const targets = (Array.isArray(condition.value) ? condition.value : [condition.value]).map(
    String,
  );
  const matches = value != null && targets.includes(String(value.id));
  if (['notEquals', 'notIn', 'containsNone'].includes(condition.operator)) return !matches;
  if (condition.operator === 'containsAll') return targets.length === 1 && matches;
  if (['equals', 'in', 'containsAny'].includes(condition.operator)) return matches;
  return undefined;
}

function selectionCount(selection: GridSelectionState): number {
  return selection.mode === 'explicit'
    ? selection.selectedKeys.length
    : Math.max(0, selection.total - selection.excludedKeys.length);
}

function selectedOrderIds(
  rows: readonly DemoOrder[],
  selection: GridSelectionState,
  query: GridQuery,
  definition: GridResolvedDefinition<DemoOrder>,
): Set<number> {
  if (selection.mode === 'explicit') return new Set(selection.selectedKeys.map(Number));
  const excluded = new Set(selection.excludedKeys.map(Number));
  const result = applyLocalGridQuery(
    rows,
    {
      ...query,
      pagination: { type: 'offset', page: 1, pageSize: Math.max(1, rows.length) },
    },
    definition,
  );
  return new Set(result.rows.map((row) => row.id).filter((id) => !excluded.has(id)));
}

interface UseOrderGridDefinitionOptions {
  getOrders: () => DemoOrder[];
  setOrders: Dispatch<SetStateAction<DemoOrder[]>>;
  openDetail: (order: DemoOrder, source: string) => void;
  openEditor: (order?: DemoOrder) => void;
  deleteOrder: (order: DemoOrder, signal?: AbortSignal) => Promise<void>;
  duplicateOrder: (order: DemoOrder, signal: AbortSignal) => Promise<void>;
  ordersChanged: () => void;
  record: (text: string) => void;
  success: (text: string) => void;
}

export function useOrderGridDefinition({
  getOrders,
  setOrders,
  openDetail,
  openEditor,
  deleteOrder,
  duplicateOrder,
  ordersChanged,
  record,
  success,
}: UseOrderGridDefinitionOptions): GridDefinition<DemoOrder> {
  return useMemo(() => {
    let definition: GridDefinition<DemoOrder>;
    const getSelectedIds = (selection: GridSelectionState, query: GridQuery) =>
      selectedOrderIds(getOrders(), selection, query, resolveGridDefinition(definition));

    definition = defineGrid<DemoOrder>({
      id: 'data-grid-demo-orders',
      revision: 1,
      rowKey: 'id',
      defaults: { pageSize: 20, density: 'compact', selection: true, views: true },
      fields: [
        orderField.property('orderNo', {
          title: '订单号',
          filter: true,
          sort: true,
          column: { width: 150, fixed: 'left', minWidth: 120 },
        }),
        orderField.property('customer', {
          title: '客户',
          valueType: 'relation',
          filter: true,
          transport: { filterKey: 'customer_id' },
          searchText: (value) => value.name,
          options: customerOptions,
          filterPredicate: matchEntityId,
          column: { width: 160 },
        }),
        orderField.property('amount', {
          title: '订单金额',
          valueType: 'money',
          filter: true,
          sort: true,
          meta: { currency: 'CNY' },
          column: { width: 140 },
        }),
        orderField.property('status', {
          title: '状态',
          valueType: 'status',
          filter: true,
          sort: true,
          edit: { enabled: true, required: true },
          options: statusOptions,
          column: { width: 120 },
        }),
        orderField.property('risk', {
          title: '风险',
          valueType: 'status',
          filter: true,
          options: riskOptions,
          column: { width: 108 },
        }),
        orderField.property('owner', {
          title: '负责人',
          valueType: 'user',
          filter: true,
          transport: { filterKey: 'owner_id' },
          options: ownerOptions,
          filterPredicate: matchEntityId,
          column: { width: 126 },
        }),
        orderField.property('tags', {
          title: '标签',
          valueType: 'multiSelect',
          filter: true,
          options: tagOptions,
          column: { width: 160 },
        }),
        orderField.property('paid', {
          title: '已支付',
          valueType: 'boolean',
          filter: true,
          column: { width: 92, align: 'center' },
        }),
        orderField.property('createdAt', {
          title: '创建时间',
          valueType: 'dateTime',
          filter: true,
          sort: true,
          column: { width: 176 },
        }),
      ],
      columns: [
        {
          id: 'identity',
          title: '订单信息',
          children: [
            { id: 'orderNumber', fieldId: 'orderNo' },
            { id: 'customerName', fieldId: 'customer' },
          ],
        },
        {
          id: 'commercial',
          title: '商务信息',
          children: [
            { id: 'amountValue', fieldId: 'amount' },
            { id: 'statusValue', fieldId: 'status' },
            { id: 'riskValue', fieldId: 'risk' },
          ],
        },
        { id: 'ownerValue', fieldId: 'owner' },
        { id: 'tagValues', fieldId: 'tags' },
        { id: 'paidValue', fieldId: 'paid' },
        { id: 'createdTime', fieldId: 'createdAt' },
      ],
      actions: [
        {
          id: 'create',
          label: '新建订单',
          icon: <PlusOutlined />,
          intent: 'primary',
          placement: 'toolbar',
          order: 1,
          run: () => openEditor(),
        },
        {
          id: 'export',
          label: '导出当前查询',
          icon: <DownloadOutlined />,
          placement: 'toolbar',
          order: 2,
          run: async ({ request, signal }) => {
            await waitForServer(500, signal);
            const orders = getOrders();
            const exportRequest: GridRequestQuery = {
              ...request,
              pagination: { type: 'offset', page: 1, pageSize: Math.max(1, orders.length) },
            };
            const exported = executeOrderRequest(
              orders,
              exportRequest,
              resolveGridDefinition(definition),
            ).rows;
            downloadOrdersCsv(exported, `orders-${new Date().toISOString().slice(0, 10)}.csv`);
            record(`导出当前查询：${exported.length} 条订单`);
            success(`已下载 ${exported.length} 条订单`);
          },
        },
        {
          id: 'inspect',
          label: '查看',
          icon: <EyeOutlined />,
          placement: 'row',
          order: 1,
          run: ({ row }) => row && openDetail(row, '行快捷操作'),
        },
        {
          id: 'edit',
          label: '编辑',
          icon: <EditOutlined />,
          placement: 'row',
          order: 2,
          run: ({ row }) => row && openEditor(row),
        },
        {
          id: 'duplicate',
          label: '复制',
          icon: <CopyOutlined />,
          placement: 'row',
          order: 3,
          run: async ({ row, signal }) => {
            if (row) await duplicateOrder(row, signal);
          },
        },
        {
          id: 'delete',
          label: '删除',
          icon: <DeleteOutlined />,
          placement: 'row',
          intent: 'danger',
          order: 4,
          getConfirmation: ({ row }) => (row ? `确认删除 ${row.orderNo}？` : undefined),
          run: async ({ row, signal }) => {
            if (row) await deleteOrder(row, signal);
          },
        },
        {
          id: 'bulkComplete',
          label: '批量完成',
          icon: <CheckCircleOutlined />,
          placement: 'bulk',
          order: 1,
          getConfirmation: ({ selection }) =>
            `确认将选中的 ${selectionCount(selection)} 条订单设为已完成？`,
          run: async ({ selection, query, instance, signal }) => {
            await waitForServer(380, signal);
            const ids = getSelectedIds(selection, query);
            setOrders((current) =>
              current.map((item) =>
                ids.has(item.id) ? { ...item, status: 'completed' as const } : item,
              ),
            );
            ordersChanged();
            instance.selection.clear();
            record(`批量完成：${ids.size} 条订单`);
            success(`已更新 ${ids.size} 条订单`);
          },
        },
        {
          id: 'bulkExport',
          label: '导出选中项',
          icon: <DownloadOutlined />,
          placement: 'bulk',
          order: 2,
          run: async ({ selection, query, signal }) => {
            await waitForServer(450, signal);
            const ids = getSelectedIds(selection, query);
            const exported = getOrders().filter((order) => ids.has(order.id));
            downloadOrdersCsv(
              exported,
              `selected-orders-${new Date().toISOString().slice(0, 10)}.csv`,
            );
            record(`批量导出：${exported.length} 条订单`);
            success(`已下载 ${exported.length} 条订单`);
          },
        },
        {
          id: 'bulkDelete',
          label: '批量删除',
          icon: <DeleteOutlined />,
          placement: 'bulk',
          intent: 'danger',
          order: 3,
          getConfirmation: ({ selection }) =>
            `确认删除选中的 ${selectionCount(selection)} 条订单？`,
          run: async ({ selection, query, instance, signal }) => {
            await waitForServer(380, signal);
            const ids = getSelectedIds(selection, query);
            setOrders((current) => current.filter((item) => !ids.has(item.id)));
            ordersChanged();
            instance.selection.clear();
            record(`批量删除：${ids.size} 条订单`);
            success(`已删除 ${ids.size} 条订单`);
          },
        },
      ],
      editing: {
        optimistic: true,
        reloadOnSave: false,
        apply: (row, field, value) => ({ ...row, [field.id]: value }),
        save: async ({ row, field, value, signal }) => {
          await waitForServer(500, signal);
          const updated = { ...row, [field.id]: value } as DemoOrder;
          setOrders((current) => current.map((item) => (item.id === updated.id ? updated : item)));
          ordersChanged();
          record(`快捷编辑 ${field.title as string}：${row.orderNo}`);
          success(`${row.orderNo} 已保存`);
          return updated;
        },
      },
    });
    return definition;
  }, [
    deleteOrder,
    duplicateOrder,
    getOrders,
    openDetail,
    openEditor,
    ordersChanged,
    record,
    setOrders,
    success,
  ]);
}
