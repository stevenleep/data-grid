import {
  CheckCircleOutlined,
  CloudServerOutlined,
  CodeOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  ExperimentOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { App, Button, Card, Flex, Space, Statistic, Tabs, Tag, Typography } from 'antd';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  DataGrid,
  GridActions,
  GridActiveFilters,
  GridColumnTrigger,
  GridFilterTrigger,
  GridFooter,
  GridPagination,
  GridRefresh,
  GridSearch,
  GridSelectionSummary,
  GridShell,
  GridSortTrigger,
  GridStatus,
  GridSummary,
  GridTable,
  GridToolbar,
  GridTotal,
  GridViewTrigger,
  applyLocalGridQuery,
  createFieldHelper,
  createLocalGridPersistence,
  createRemoteSource,
  defineGrid,
  resolveGridDefinition,
  useGridInstance,
  useGridSelector,
  type GridCellClickContext,
  type GridDefinition,
  type GridEvent,
  type GridFilterCondition,
  type GridQuery,
  type GridRequestQuery,
  type GridResolvedDefinition,
  type GridSelectionState,
} from '@huiyun/data-grid';
import {
  createDemoOrders,
  demoCustomers,
  demoOwners,
  demoTags,
  waitForServer,
  type DemoOrder,
} from './data';
import { OrderDetail } from './OrderDetail';
import { OrderEditor, type OrderFormValues } from './OrderEditor';
import { DocsPanel } from './DocsPanel';

const statusOptions = [
  { label: '待处理', value: 'pending', color: 'gold' },
  { label: '处理中', value: 'processing', color: 'blue' },
  { label: '已完成', value: 'completed', color: 'green' },
  { label: '已取消', value: 'cancelled', color: 'default' },
];

const riskOptions = [
  { label: '低风险', value: 'low', color: 'green' },
  { label: '中风险', value: 'medium', color: 'gold' },
  { label: '高风险', value: 'high', color: 'red' },
];

const ownerOptions = demoOwners.map(({ id, name }) => ({ label: name, value: id }));
const customerOptions = demoCustomers.map(({ id, name }) => ({ label: name, value: id }));
const tagOptions = demoTags.map((value) => ({ label: value, value }));
const orderField = createFieldHelper<DemoOrder>();

interface DetailState {
  order: DemoOrder;
  source: string;
}

interface ActivityItem {
  id: string;
  text: string;
  time: string;
}

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
  if (['equals', 'in', 'containsAny', 'containsAll'].includes(condition.operator)) return matches;
  return undefined;
}

function selectionCount(selection: GridSelectionState): number {
  return selection.mode === 'explicit'
    ? selection.selectedKeys.length
    : Math.max(0, selection.total - selection.excludedKeys.length);
}

function selectedOrderIds(
  rows: DemoOrder[],
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

function ProtocolPreview() {
  const instance = useGridInstance<DemoOrder>();
  const request = useGridSelector<DemoOrder, GridRequestQuery>(() => instance.query.compile());
  return (
    <details className="protocol-preview">
      <summary>
        <CodeOutlined /> 当前传输协议
      </summary>
      <pre>{JSON.stringify(request, null, 2)}</pre>
    </details>
  );
}

function DemoMetrics({ total, requests }: { total: number; requests: number }) {
  return (
    <div className="demo-metrics">
      <Statistic title="当前订单" value={total} suffix="条" />
      <Statistic title="服务端请求" value={requests} suffix="次" />
      <Statistic title="验收能力" value={10} suffix="项" />
    </div>
  );
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
  const ordersRef = useRef(orders);
  ordersRef.current = orders;
  const [requestCount, setRequestCount] = useState(0);
  const [lastRequest, setLastRequest] = useState<GridRequestQuery>();
  const [editorOrder, setEditorOrder] = useState<DemoOrder | 'create'>();
  const [detail, setDetail] = useState<DetailState>();
  const [activity, setActivity] = useState<ActivityItem[]>([]);

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
      setDetail((current) => (current?.order.id === order.id ? undefined : current));
      record(`删除订单：${order.orderNo}`);
      message.success(`${order.orderNo} 已删除`);
    },
    [message, record],
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
      record(`复制订单：${order.orderNo} → ${duplicate.orderNo}`);
      message.success(`已复制为 ${duplicate.orderNo}`);
    },
    [message, record],
  );

  const definition = useMemo<GridDefinition<DemoOrder>>(() => {
    let nextDefinition: GridDefinition<DemoOrder>;
    const getSelectedIds = (selection: GridSelectionState, query: GridQuery) =>
      selectedOrderIds(ordersRef.current, selection, query, resolveGridDefinition(nextDefinition));

    nextDefinition = defineGrid<DemoOrder>({
      id: 'data-grid-demo-orders',
      revision: 1,
      rowKey: 'id',
      defaults: {
        pageSize: 20,
        density: 'compact',
        selection: true,
        views: true,
      },
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
            record(`快捷导出：${request.keyword || '当前全部查询'}`);
            message.success(`已导出查询：${request.keyword || '全部订单'}`);
          },
        },
        {
          id: 'inspect',
          label: '查看',
          icon: <EyeOutlined />,
          placement: 'row',
          order: 1,
          run: ({ row }) => {
            if (row) openDetail(row, '行快捷操作');
          },
        },
        {
          id: 'edit',
          label: '编辑',
          icon: <EditOutlined />,
          placement: 'row',
          order: 2,
          run: ({ row }) => {
            if (row) openEditor(row);
          },
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
            instance.selection.clear();
            record(`批量完成：${ids.size} 条订单`);
            message.success(`已更新 ${ids.size} 条订单`);
          },
        },
        {
          id: 'bulkExport',
          label: '导出选中项',
          icon: <DownloadOutlined />,
          placement: 'bulk',
          order: 2,
          run: async ({ selection, signal }) => {
            await waitForServer(450, signal);
            const count = selectionCount(selection);
            record(`批量导出：${count} 条订单`);
            message.success(`已生成 ${count} 条记录的导出任务`);
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
            instance.selection.clear();
            record(`批量删除：${ids.size} 条订单`);
            message.success(`已删除 ${ids.size} 条订单`);
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
          record(`快捷编辑 ${field.title as string}：${row.orderNo}`);
          message.success(`${row.orderNo} 已保存`);
          return updated;
        },
      },
    });
    return nextDefinition;
  }, [deleteOrder, duplicateOrder, message, openDetail, openEditor, record]);

  const resolvedDefinition = useMemo(() => resolveGridDefinition(definition), [definition]);
  const source = useMemo(
    () =>
      createRemoteSource<DemoOrder>({
        capabilities: {
          pagination: 'offset',
          search: true,
          filter: { logic: 'nested', negation: true, maxDepth: 3, maxConditions: 20 },
          sort: { max: 3, nulls: true },
          projection: true,
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
        read: async ({ query, request, signal }) => {
          setRequestCount((count) => count + 1);
          setLastRequest(request);
          await waitForServer(320 + Math.round(Math.random() * 280), signal);
          const result = applyLocalGridQuery(orders, query, resolvedDefinition);
          const pageAmount = result.rows.reduce((sum, row) => sum + row.amount, 0);
          return {
            ...result,
            summary: [
              {
                id: 'pageAmount',
                label: '本页金额',
                value: pageAmount,
                aggregate: 'sum',
                scope: 'page',
                render: (value) =>
                  new Intl.NumberFormat('zh-CN', {
                    style: 'currency',
                    currency: 'CNY',
                  }).format(Number(value)),
              },
            ],
            facets: {
              status: statusOptions,
              risk: riskOptions,
              owner: ownerOptions,
              customer: customerOptions,
            },
          };
        },
      }),
    [orders, resolvedDefinition],
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
    if (editorOrder && editorOrder !== 'create') {
      const updated: DemoOrder = { ...editorOrder, ...values, customer, owner };
      setOrders((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setDetail((current) =>
        current?.order.id === updated.id ? { ...current, order: updated } : current,
      );
      record(`保存编辑：${updated.orderNo}`);
      message.success(`${updated.orderNo} 修改成功`);
    } else {
      const id = Math.max(0, ...ordersRef.current.map((item) => item.id)) + 1;
      const created: DemoOrder = {
        ...values,
        id,
        orderNo: `HY-${20260000 + id}`,
        customer,
        owner,
        createdAt: new Date().toISOString(),
      };
      setOrders((current) => [created, ...current]);
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

  const reset = () => {
    setOrders(createDemoOrders());
    setDetail(undefined);
    record('重置全部演示数据');
    message.success('演示数据已重置');
  };

  const interactionProps = {
    onRowClick: ({ row }: { row: DemoOrder }) => openDetail(row, '行点击'),
    onCellClick: handleCellClick,
    isCellClickable: ({ field }: { field?: { id: string } }) =>
      Boolean(field && ['orderNo', 'customer'].includes(field.id)),
    onEvent: recordGridEvent,
  };

  return (
    <main className="demo-page">
      <header className="demo-hero">
        <div>
          <div className="demo-eyebrow">
            <ExperimentOutlined /> INTERACTIVE PACKAGE DEMO
          </div>
          <Typography.Title level={1}>@huiyun/data-grid</Typography.Title>
          <Typography.Paragraph>
            面向 Admin 的协议驱动数据表格。现在这不是静态样例，而是一套可完整验收的订单工作台。
          </Typography.Paragraph>
          <Space wrap>
            <Tag icon={<CheckCircleOutlined />} color="success">
              Full CRUD
            </Tag>
            <Tag icon={<SafetyCertificateOutlined />} color="blue">
              Ant Design 6
            </Tag>
            <Tag icon={<CloudServerOutlined />} color="geekblue">
              Remote Protocol
            </Tag>
          </Space>
        </div>
        <DemoMetrics total={orders.length} requests={requestCount} />
      </header>

      <section className="demo-content">
        <Tabs
          size="large"
          items={[
            {
              key: 'complete',
              label: '完整业务工作台',
              children: (
                <div className="demo-stage demo-stage--with-inspector">
                  <div className="demo-grid-column">
                    <div className="stage-heading">
                      <div>
                        <Typography.Title level={3}>订单管理</Typography.Title>
                        <Typography.Text type="secondary">
                          单击行查看详情；点击订单号或客户值验证值事件；点击状态可快捷编辑。
                        </Typography.Text>
                      </div>
                      <Space>
                        <Button
                          type="primary"
                          icon={<ThunderboltOutlined />}
                          onClick={() => openEditor()}
                        >
                          快捷新建
                        </Button>
                        <Button icon={<ReloadOutlined />} onClick={reset}>
                          重置数据
                        </Button>
                      </Space>
                    </div>
                    <div className="capability-strip" aria-label="可验收能力">
                      {[
                        '新增',
                        '查看',
                        '编辑',
                        '删除',
                        '排序',
                        '过滤',
                        '分页',
                        '行点击',
                        '值点击',
                        '批量操作',
                      ].map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                    </div>
                    <DataGrid<DemoOrder>
                      definition={definition}
                      source={source}
                      persistence={persistence}
                      pageSizeOptions={[10, 20, 50]}
                      className="demo-grid"
                      rowActions={{ maxVisible: 2, width: 172 }}
                      tableProps={{ scroll: { y: 430 } }}
                      onError={(error) => message.error(error.message)}
                      {...interactionProps}
                    />
                  </div>
                  <Card className="request-inspector" title="请求与交互" size="small">
                    <Typography.Text className="inspector-label" type="secondary">
                      最近操作
                    </Typography.Text>
                    <div className="activity-feed">
                      {activity.length ? (
                        activity.map((item) => (
                          <div className="activity-item" key={item.id}>
                            <span>{item.text}</span>
                            <time>{item.time}</time>
                          </div>
                        ))
                      ) : (
                        <div className="activity-empty">开始操作表格后，这里会记录事件。</div>
                      )}
                    </div>
                    <Typography.Text className="inspector-label" type="secondary">
                      最新服务端请求
                    </Typography.Text>
                    <pre>{JSON.stringify(lastRequest ?? { waiting: true }, null, 2)}</pre>
                  </Card>
                </div>
              ),
            },
            {
              key: 'composed',
              label: '自由组合',
              children: (
                <div className="demo-stage">
                  <DataGrid<DemoOrder>
                    definition={composedDefinition}
                    source={source}
                    pageSizeOptions={[10, 20, 50]}
                    onError={(error) => message.error(error.message)}
                    {...interactionProps}
                  >
                    {() => (
                      <GridShell className="demo-grid demo-grid--composed">
                        <div className="composed-heading">
                          <div>
                            <span className="composed-kicker">CUSTOM RECIPE</span>
                            <Typography.Title level={3}>高价值订单工作台</Typography.Title>
                          </div>
                          <GridActions<DemoOrder> placement="toolbar" />
                        </div>
                        <GridToolbar
                          start={
                            <Flex wrap gap={4}>
                              <GridViewTrigger<DemoOrder> />
                              <GridColumnTrigger<DemoOrder> />
                              <GridFilterTrigger<DemoOrder> />
                              <GridSortTrigger<DemoOrder> />
                              <GridSearch<DemoOrder> width={260} />
                            </Flex>
                          }
                          end={<GridRefresh<DemoOrder> />}
                        />
                        <GridActiveFilters<DemoOrder> />
                        <GridStatus<DemoOrder> />
                        <GridTable<DemoOrder>
                          rowActions={{ maxVisible: 2, width: 172 }}
                          tableProps={{ scroll: { y: 410 } }}
                        />
                        <GridFooter
                          start={
                            <Space size={16}>
                              <GridSelectionSummary<DemoOrder> />
                              <GridSummary<DemoOrder> />
                              <GridTotal<DemoOrder> />
                            </Space>
                          }
                          end={<GridPagination<DemoOrder> />}
                        />
                        <ProtocolPreview />
                      </GridShell>
                    )}
                  </DataGrid>
                </div>
              ),
            },
            {
              key: 'docs',
              label: '开发文档',
              children: <DocsPanel />,
            },
          ]}
        />
      </section>

      <footer className="demo-page-footer">
        <span>pnpm demo</span>
        <span>·</span>
        <span>所有数据与网络请求均在浏览器本地模拟</span>
      </footer>

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
