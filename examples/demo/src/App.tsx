import { App } from 'antd';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  createLocalGridPersistence,
  createRemoteSource,
  resolveGridDefinition,
  type GridCellClickContext,
  type GridEvent,
  type GridInstance,
  type GridRequestQuery,
} from '@stevenleep/data-grid';
import { createDemoOrders, demoCustomers, demoOwners, waitForServer, type DemoOrder } from './data';
import { DemoWorkbench, type ActivityItem, type OrderGridInteractions } from './DemoWorkbench';
import { OrderDetail } from './OrderDetail';
import { OrderEditor, type OrderFormValues } from './OrderEditor';
import { executeOrderRequest } from './mockOrderApi';
import {
  customerOptions,
  ownerOptions,
  riskOptions,
  statusOptions,
  useOrderGridDefinition,
} from './orderGridDefinition';

interface DetailState {
  order: DemoOrder;
  source: string;
}

const eventLabels: Record<string, string> = {
  'query.keyword': '执行搜索',
  'query.filters': '应用筛选',
  'query.sorts': '变更排序',
  'query.page': '切换分页',
  'query.pageSize': '修改每页数量',
  'selection.change': '变更行选择',
  'columns.visibility': '调整字段显示',
  'columns.order': '调整字段顺序',
  'columns.width': '调整字段宽度',
  'editing.begin': '开始单元格编辑',
};

export function DemoApp() {
  const { message, modal } = App.useApp();
  const [orders, setOrders] = useState(createDemoOrders);
  const [ordersRevision, setOrdersRevision] = useState(0);
  const ordersRef = useRef(orders);
  ordersRef.current = orders;
  const [requestCount, setRequestCount] = useState(0);
  const [lastRequest, setLastRequest] = useState<GridRequestQuery>();
  const [editorOrder, setEditorOrder] = useState<DemoOrder | 'create'>();
  const [detail, setDetail] = useState<DetailState>();
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [gridSession, setGridSession] = useState(0);
  const [resetting, setResetting] = useState(false);
  const primaryGridRef = useRef<GridInstance<DemoOrder> | undefined>(undefined);

  const getOrders = useCallback(() => ordersRef.current, []);
  const capturePrimaryGrid = useCallback((instance?: GridInstance<DemoOrder>) => {
    primaryGridRef.current = instance;
  }, []);
  const success = useCallback(
    (text: string) => {
      void message.success(text);
    },
    [message],
  );
  const markOrdersChanged = useCallback(() => {
    setOrdersRevision((revision) => revision + 1);
  }, []);

  const record = useCallback((text: string) => {
    const now = new Date();
    setActivity((current) =>
      [
        {
          id: `${now.getTime()}-${text}`,
          text,
          time: now.toLocaleTimeString('zh-CN', { hour12: false }),
        },
        ...current,
      ].slice(0, 6),
    );
  }, []);

  const openDetail = useCallback(
    (order: DemoOrder, source: string) => {
      setDetail({ order, source });
      record(`${source}：${order.orderNo}`);
    },
    [record],
  );

  const openEditor = useCallback(
    (order?: DemoOrder) => {
      setEditorOrder(order || 'create');
      record(order ? `打开编辑：${order.orderNo}` : '打开新建订单');
    },
    [record],
  );

  const deleteOrder = useCallback(
    async (order: DemoOrder, signal = new AbortController().signal) => {
      await waitForServer(320, signal);
      setOrders((current) => current.filter((item) => item.id !== order.id));
      markOrdersChanged();
      setDetail((current) => (current?.order.id === order.id ? undefined : current));
      record(`删除订单：${order.orderNo}`);
      message.success(`${order.orderNo} 已删除`);
    },
    [markOrdersChanged, message, record],
  );

  const confirmDelete = useCallback(
    (order: DemoOrder) => {
      modal.confirm({
        title: `删除订单 ${order.orderNo}？`,
        content: '此操作用于演示完整删除流程，删除后可通过“重置数据”恢复。',
        okText: '确认删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: () => deleteOrder(order),
      });
    },
    [deleteOrder, modal],
  );

  const duplicateOrder = useCallback(
    async (order: DemoOrder, signal: AbortSignal) => {
      await waitForServer(280, signal);
      const nextId = Math.max(0, ...ordersRef.current.map((item) => item.id)) + 1;
      const duplicate: DemoOrder = {
        ...order,
        id: nextId,
        orderNo: `HY-${20260000 + nextId}`,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      setOrders((current) => [duplicate, ...current]);
      markOrdersChanged();
      record(`复制订单：${order.orderNo} → ${duplicate.orderNo}`);
      message.success(`已复制为 ${duplicate.orderNo}`);
    },
    [markOrdersChanged, message, record],
  );

  const definition = useOrderGridDefinition({
    getOrders,
    setOrders,
    openDetail,
    openEditor,
    deleteOrder,
    duplicateOrder,
    ordersChanged: markOrdersChanged,
    record,
    success,
  });
  const resolvedDefinition = useMemo(() => resolveGridDefinition(definition), [definition]);

  const source = useMemo(
    () =>
      createRemoteSource<DemoOrder>({
        datasetKey: 'interactive-demo:orders',
        driverKey: ordersRevision,
        capabilities: {
          pagination: 'offset',
          search: true,
          filter: { logic: 'nested', negation: true, maxDepth: 3, maxConditions: 20 },
          sort: { max: 3, nulls: true },
          summary: true,
          facets: true,
          selectAllMatching: true,
        },
        policy: {
          keepPreviousData: true,
          cacheTime: 30_000,
          staleTime: 2_000,
          maxCacheEntries: 12,
        },
        read: async ({ request, signal }) => {
          setRequestCount((count) => count + 1);
          setLastRequest(request);
          await waitForServer(320 + Math.round(Math.random() * 280), signal);
          const result = executeOrderRequest(ordersRef.current, request, resolvedDefinition);
          return {
            ...result,
            snapshotId: `orders:${ordersRevision}`,
            facets: {
              status: statusOptions,
              risk: riskOptions,
              owner: ownerOptions,
              customer: customerOptions,
            },
          };
        },
      }),
    [ordersRevision, resolvedDefinition],
  );

  const composedSource = useMemo(
    () =>
      createRemoteSource<DemoOrder>({
        datasetKey: 'interactive-demo:orders:composed',
        driverKey: ordersRevision,
        capabilities: {
          pagination: 'offset',
          search: true,
          filter: { logic: 'nested', negation: true, maxDepth: 3, maxConditions: 20 },
          sort: { max: 3, nulls: true },
          summary: true,
          facets: true,
          selectAllMatching: true,
        },
        policy: { keepPreviousData: true, cacheTime: 15_000, maxCacheEntries: 6 },
        read: async ({ request, signal }) => {
          await waitForServer(260, signal);
          const result = executeOrderRequest(ordersRef.current, request, resolvedDefinition);
          return {
            ...result,
            snapshotId: `orders:${ordersRevision}`,
            facets: {
              status: statusOptions,
              risk: riskOptions,
              owner: ownerOptions,
              customer: customerOptions,
            },
          };
        },
      }),
    [ordersRevision, resolvedDefinition],
  );

  const composedDefinition = useMemo(
    () => ({ ...definition, id: 'data-grid-demo-composed' }),
    [definition],
  );
  const persistence = useMemo(
    () => createLocalGridPersistence<DemoOrder>({ scope: 'interactive-demo' }),
    [],
  );

  const saveOrder = async (values: OrderFormValues) => {
    await waitForServer(420, new AbortController().signal);
    const customer = demoCustomers.find((item) => item.id === values.customerId)!;
    const owner = demoOwners.find((item) => item.id === values.ownerId)!;
    const orderValues: Pick<DemoOrder, 'amount' | 'status' | 'risk' | 'tags' | 'paid'> = {
      amount: values.amount,
      status: values.status,
      risk: values.risk,
      tags: values.tags,
      paid: values.paid,
    };
    if (editorOrder && editorOrder !== 'create') {
      const updated: DemoOrder = { ...editorOrder, ...orderValues, customer, owner };
      setOrders((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      markOrdersChanged();
      setDetail((current) =>
        current?.order.id === updated.id ? { ...current, order: updated } : current,
      );
      record(`保存编辑：${updated.orderNo}`);
      message.success(`${updated.orderNo} 修改成功`);
    } else {
      const id = Math.max(0, ...ordersRef.current.map((item) => item.id)) + 1;
      const created: DemoOrder = {
        ...orderValues,
        id,
        orderNo: `HY-${20260000 + id}`,
        customer,
        owner,
        createdAt: new Date().toISOString(),
      };
      setOrders((current) => [created, ...current]);
      markOrdersChanged();
      record(`创建订单：${created.orderNo}`);
      message.success(`${created.orderNo} 创建成功`);
    }
    setEditorOrder(undefined);
  };

  const handleCellClick = useCallback(
    ({ row, field, event }: GridCellClickContext<DemoOrder>) => {
      event.stopPropagation();
      openDetail(row, `值点击 · ${String(field?.title || field?.id)}`);
    },
    [openDetail],
  );
  const recordGridEvent = useCallback(
    (event: GridEvent) => {
      if (event.reason === 'user' && eventLabels[event.type]) record(eventLabels[event.type]!);
    },
    [record],
  );

  const reset = async () => {
    if (resetting) return;
    setResetting(true);
    try {
      await primaryGridRef.current?.flushPersistence();
      await persistence.clear?.(resolvedDefinition.id, { definition: resolvedDefinition });
      try {
        window.localStorage.removeItem('@huiyun/data-grid:interactive-demo:data-grid-demo-orders');
      } catch {
        // Storage can be unavailable in privacy-restricted browser contexts.
      }
      setOrders(createDemoOrders());
      markOrdersChanged();
      setDetail(undefined);
      setEditorOrder(undefined);
      setRequestCount(0);
      setLastRequest(undefined);
      setActivity([]);
      setGridSession((current) => current + 1);
      message.success('数据、查询、视图与字段偏好已恢复出厂状态');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '恢复出厂状态失败，请重试。');
    } finally {
      setResetting(false);
    }
  };

  const interactions: OrderGridInteractions = {
    onRowClick: ({ row }) => openDetail(row, '行点击'),
    onCellClick: handleCellClick,
    isCellClickable: ({ field }) => Boolean(field && ['orderNo', 'customer'].includes(field.id)),
    onEvent: recordGridEvent,
  };
  const handleError = (error: Error) => message.error(error.message);

  return (
    <main className="demo-page">
      <DemoWorkbench
        total={orders.length}
        requests={requestCount}
        primary={{
          session: gridSession,
          definition,
          source,
          persistence,
          capture: capturePrimaryGrid,
        }}
        composed={{ definition: composedDefinition, source: composedSource }}
        activity={activity}
        lastRequest={lastRequest}
        resetting={resetting}
        interactions={interactions}
        onCreate={() => openEditor()}
        onReset={() => void reset()}
        onError={handleError}
      />

      <OrderEditor
        open={Boolean(editorOrder)}
        order={editorOrder === 'create' ? undefined : editorOrder}
        onCancel={() => setEditorOrder(undefined)}
        onSubmit={saveOrder}
      />
      <OrderDetail
        order={detail?.order}
        source={detail?.source}
        onClose={() => setDetail(undefined)}
        onEdit={(order) => openEditor(order)}
        onDelete={confirmDelete}
      />
    </main>
  );
}
