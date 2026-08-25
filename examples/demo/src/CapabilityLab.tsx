import {
  ApiOutlined,
  CloudServerOutlined,
  ControlOutlined,
  DatabaseOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Empty, Segmented, Space, Statistic, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DataGrid,
  applyLocalGridQuery,
  compileGridQuery,
  createControlledSource,
  createFieldHelper,
  createFilterGroup,
  createLocalSource,
  createRemoteSource,
  defineGrid,
  getRequestSignature,
  resolveGridDefinition,
  type GridCapabilities,
  type GridDataSource,
  type GridQuery,
  type GridRequestQuery,
  type GridSelectionState,
} from '@stevenleep/data-grid';
import { createDemoOrders, waitForServer, type DemoOrder } from './data';
import { executeOrderRequest } from './mockOrderApi';

type LabMode = 'remote' | 'local' | 'controlled';
type RemoteScenario = 'normal' | 'slow' | 'empty' | 'error';

const field = createFieldHelper<DemoOrder>();
const labRows = createDemoOrders(43);

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

const capabilities = {
  pagination: 'offset',
  search: true,
  filter: { logic: 'nested', negation: true, maxDepth: 3, maxConditions: 12 },
  sort: { max: 3, nulls: true },
  projection: true,
  summary: true,
  facets: true,
} satisfies GridCapabilities;

const definition = defineGrid<DemoOrder>({
  id: 'data-grid-demo-capability-lab',
  rowKey: 'id',
  defaults: { pageSize: 8, density: 'compact', selection: true, views: false },
  fields: [
    field.property('orderNo', {
      title: '订单号',
      filter: true,
      sort: true,
      column: { width: 150, fixed: 'left' },
    }),
    field.property('customer', {
      title: '客户',
      valueType: 'relation',
      searchText: (value) => value.name,
      column: { width: 150 },
    }),
    field.property('amount', {
      title: '金额',
      valueType: 'money',
      filter: true,
      sort: true,
      meta: { currency: 'CNY' },
      column: { width: 132 },
    }),
    field.property('status', {
      title: '状态',
      valueType: 'status',
      filter: true,
      sort: true,
      options: statusOptions,
      column: { width: 112 },
    }),
    field.property('risk', {
      title: '风险',
      valueType: 'status',
      filter: true,
      options: riskOptions,
      column: { width: 104 },
    }),
    field.property('owner', {
      title: '负责人',
      valueType: 'user',
      searchText: (value) => value.name,
      column: { width: 120 },
    }),
    field.property('createdAt', {
      title: '创建时间',
      valueType: 'dateTime',
      filter: true,
      sort: true,
      column: { width: 176 },
    }),
  ],
});

const resolvedDefinition = resolveGridDefinition(definition);

function createInitialQuery(): GridQuery {
  return {
    pagination: { type: 'offset', page: 1, pageSize: 8 },
    keyword: '',
    filters: createFilterGroup(),
    sorts: [],
  };
}

function createEmptySelection(): GridSelectionState {
  return { mode: 'explicit', selectedKeys: [] };
}

const modeProfiles: Record<
  LabMode,
  {
    label: string;
    compactLabel: string;
    icon: ReactNode;
    owner: string;
    execution: string;
    description: string;
  }
> = {
  remote: {
    label: 'Remote API',
    compactLabel: '远程',
    icon: <CloudServerOutlined />,
    owner: '服务端',
    execution: '请求协议',
    description: '默认生产路径：服务端分页，自动处理取消、竞态、缓存与保留旧数据。',
  },
  local: {
    label: 'Local rows',
    compactLabel: '本地',
    icon: <DatabaseOutlined />,
    owner: 'Data Grid',
    execution: '浏览器内',
    description: '适合字典与小型配置页，仍使用完全相同的搜索、筛选和排序语义。',
  },
  controlled: {
    label: 'Controlled store',
    compactLabel: '受控',
    icon: <ControlOutlined />,
    owner: '业务 Store',
    execution: '外部受控',
    description:
      '适合 React Query、SWR、Alova 或路由 Loader；查询、结果与实体选择均由外部 Store 持有。',
  },
};

const scenarioOptions: Array<{ label: string; value: RemoteScenario }> = [
  { label: '正常响应', value: 'normal' },
  { label: '慢请求', value: 'slow' },
  { label: '空数据', value: 'empty' },
  { label: '请求失败', value: 'error' },
];

function resultWithSummary(query: GridQuery) {
  const result = applyLocalGridQuery(labRows, query, resolvedDefinition);
  return {
    ...result,
    summary: [
      {
        id: 'pageAmount',
        label: '本页金额',
        value: result.rows.reduce((total, row) => total + row.amount, 0).toFixed(2),
        aggregate: 'sum' as const,
        scope: 'page' as const,
        render: (value: unknown) =>
          new Intl.NumberFormat('zh-CN', {
            style: 'currency',
            currency: 'CNY',
          }).format(Number(value)),
      },
    ],
    facets: { status: statusOptions, risk: riskOptions },
  };
}

export function CapabilityLab() {
  const [mode, setMode] = useState<LabMode>('remote');
  const [scenario, setScenario] = useState<RemoteScenario>('normal');
  const [generation, setGeneration] = useState(0);
  const [requestCount, setRequestCount] = useState(0);
  const [lastEvent, setLastEvent] = useState('等待交互');
  const [observedRequest, setObservedRequest] = useState<GridRequestQuery>(() =>
    compileGridQuery(createInitialQuery(), resolvedDefinition),
  );
  const [controlledQuery, setControlledQuery] = useState<GridQuery>(createInitialQuery);
  const [controlledRequestSignature, setControlledRequestSignature] = useState(() => {
    const query = createInitialQuery();
    return getRequestSignature(compileGridQuery(query, resolvedDefinition));
  });
  const [controlledSnapshot, setControlledSnapshot] = useState(() => {
    const query = createInitialQuery();
    return {
      result: resultWithSummary(query),
      datasetKey: 'capability-lab:controlled:0',
      requestSignature: getRequestSignature(compileGridQuery(query, resolvedDefinition)),
      selection: createEmptySelection(),
    };
  });
  const [controlledLoading, setControlledLoading] = useState(false);
  const controlledDatasetKey = `capability-lab:controlled:${generation}`;

  useEffect(() => {
    const requestSignature = controlledRequestSignature;
    if (
      controlledSnapshot.datasetKey === controlledDatasetKey &&
      controlledSnapshot.requestSignature === requestSignature
    ) {
      setControlledLoading(false);
      return;
    }
    setControlledLoading(true);
    const timer = window.setTimeout(() => {
      setControlledSnapshot((current) => ({
        result: resultWithSummary(controlledQuery),
        datasetKey: controlledDatasetKey,
        requestSignature,
        selection:
          current.datasetKey === controlledDatasetKey ? current.selection : createEmptySelection(),
      }));
      setControlledLoading(false);
    }, 360);
    return () => window.clearTimeout(timer);
  }, [controlledDatasetKey, controlledQuery, controlledRequestSignature, controlledSnapshot]);

  const remoteSource = useMemo(
    () =>
      createRemoteSource<DemoOrder>({
        datasetKey: `capability-lab:remote:${generation}`,
        driverKey: scenario,
        capabilities,
        policy: {
          keepPreviousData: true,
          staleTime: 1_000,
          cacheTime: 20_000,
          maxCacheEntries: 8,
        },
        read: async ({ request, signal }) => {
          setRequestCount((current) => current + 1);
          setObservedRequest(request);
          await waitForServer(scenario === 'slow' ? 1_800 : 420, signal);
          if (scenario === 'error') {
            throw new Error('模拟接口暂时不可用，请恢复正常响应后重试。');
          }
          if (scenario === 'empty') {
            return {
              rows: [],
              total: { value: 0, accuracy: 'exact' },
              pageInfo: { hasPrevious: false, hasNext: false },
            };
          }
          return {
            ...executeOrderRequest(labRows, request, resolvedDefinition),
            facets: { status: statusOptions, risk: riskOptions },
          };
        },
      }),
    [generation, scenario],
  );

  const localSource = useMemo(
    () => createLocalSource(labRows, capabilities, `capability-lab:local:${generation}`),
    [generation],
  );

  const controlledSource = useMemo(
    () =>
      createControlledSource<DemoOrder>({
        datasetKey: controlledDatasetKey,
        resultDatasetKey: controlledSnapshot.datasetKey,
        result: controlledSnapshot.result,
        resultRequestSignature: controlledSnapshot.requestSignature,
        loading: controlledLoading,
        capabilities,
        onQueryChange: (query, request) => {
          setControlledQuery(query);
          setControlledRequestSignature(getRequestSignature(request));
          setObservedRequest(request);
          setRequestCount((current) => current + 1);
        },
      }),
    [controlledDatasetKey, controlledLoading, controlledSnapshot],
  );

  const source: GridDataSource<DemoOrder> =
    mode === 'remote' ? remoteSource : mode === 'local' ? localSource : controlledSource;
  const profile = modeProfiles[mode];

  const reset = () => {
    const query = createInitialQuery();
    setControlledQuery(query);
    const request = compileGridQuery(query, resolvedDefinition);
    setControlledRequestSignature(getRequestSignature(request));
    setObservedRequest(request);
    setRequestCount(0);
    setLastEvent('已重置');
    setScenario('normal');
    setGeneration((current) => current + 1);
  };

  return (
    <div className="demo-stage capability-lab">
      <div className="stage-heading capability-lab__heading">
        <div>
          <Typography.Title level={3}>数据源与运行状态</Typography.Title>
          <Typography.Text type="secondary">
            同一份字段协议、同一个表格配方，切换三种数据所有权并主动验证慢、空、错状态。
          </Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={reset}>
          重置实验室
        </Button>
      </div>

      <div className="capability-lab__controls">
        <Segmented<LabMode>
          block
          aria-label="数据源模式"
          value={mode}
          options={(
            Object.entries(modeProfiles) as Array<[LabMode, (typeof modeProfiles)[LabMode]]>
          ).map(([value, item]) => ({ value, label: item.compactLabel, icon: item.icon }))}
          onChange={(value) => {
            setMode(value);
            setLastEvent(`切换数据源：${modeProfiles[value].label}`);
            setRequestCount(0);
          }}
        />
        {mode === 'remote' ? (
          <Segmented<RemoteScenario>
            block
            aria-label="远程响应场景"
            value={scenario}
            options={scenarioOptions}
            onChange={(value) => {
              setScenario(value);
              setLastEvent(
                `切换响应场景：${scenarioOptions.find((item) => item.value === value)?.label}`,
              );
              setRequestCount(0);
            }}
          />
        ) : (
          <Alert
            showIcon
            type="info"
            title={mode === 'local' ? '查询在浏览器内同步执行' : '查询与结果由外部 Store 受控'}
          />
        )}
      </div>

      <div className="capability-lab__profile">
        <div>
          <span>数据所有者</span>
          <strong>{profile.owner}</strong>
        </div>
        <div>
          <span>查询执行</span>
          <strong>{profile.execution}</strong>
        </div>
        <p>{profile.description}</p>
        <Space size={4} wrap>
          <Tag color="blue">Offset 分页</Tag>
          <Tag>搜索</Tag>
          <Tag>嵌套筛选</Tag>
          <Tag>多字段排序</Tag>
        </Space>
      </div>

      <div className="capability-lab__workspace">
        <DataGrid<DemoOrder>
          key={`${mode}:${generation}`}
          definition={definition}
          source={source}
          state={
            mode === 'controlled'
              ? { query: controlledQuery, selection: controlledSnapshot.selection }
              : undefined
          }
          stateDatasetKey={mode === 'controlled' ? controlledSnapshot.datasetKey : undefined}
          className="capability-grid"
          pageSizeOptions={[8, 16, 32]}
          toolbar={{ views: false, actions: false }}
          footer={{ selection: mode === 'controlled' }}
          rowActions={false}
          tableProps={{ scroll: { y: 350 } }}
          renderEmpty={({ instance }) =>
            instance.getState().data.error ? null : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="接口返回成功，但当前查询没有数据"
              >
                {mode === 'remote' && scenario === 'empty' ? (
                  <Button
                    size="small"
                    type="primary"
                    onClick={() => {
                      setScenario('normal');
                      setLastEvent('空状态恢复：正常响应');
                    }}
                  >
                    恢复示例数据
                  </Button>
                ) : null}
              </Empty>
            )
          }
          renderError={(error) => (
            <Alert
              showIcon
              type="error"
              title="数据加载失败"
              description={error.message}
              action={
                <Button
                  size="small"
                  danger
                  onClick={() => {
                    setScenario('normal');
                    setLastEvent('错误恢复：正常响应');
                  }}
                >
                  恢复并重试
                </Button>
              }
            />
          )}
          onStateChange={(state, event) => {
            if (mode !== 'controlled' || event.type !== 'selection.change') return;
            setControlledSnapshot((current) =>
              current.datasetKey === controlledDatasetKey
                ? { ...current, selection: state.selection }
                : current,
            );
          }}
          onEvent={(event, state) => {
            if (event.reason === 'user') setLastEvent(event.type);
            if (event.type.startsWith('query.')) {
              setObservedRequest(compileGridQuery(state.query, resolvedDefinition));
            }
          }}
        />

        <Card className="capability-lab__inspector" title="运行时观测" size="small">
          <div className="capability-lab__stats">
            <Statistic title="模式" value={profile.label} prefix={<ApiOutlined />} />
            <Statistic title="查询通知 / 请求" value={requestCount} suffix="次" />
            {mode === 'controlled' ? (
              <Statistic
                title="外部 Store 选择"
                value={
                  controlledSnapshot.selection.mode === 'explicit'
                    ? controlledSnapshot.selection.selectedKeys.length
                    : controlledSnapshot.selection.total -
                      controlledSnapshot.selection.excludedKeys.length
                }
                suffix="项"
              />
            ) : null}
          </div>
          {mode === 'controlled' ? (
            <div className="capability-lab__event">
              <span>实体状态来源</span>
              <code>
                {controlledSnapshot.datasetKey === controlledDatasetKey
                  ? controlledSnapshot.datasetKey
                  : '旧状态已屏蔽，等待新数据原子确认'}
              </code>
            </div>
          ) : null}
          <div className="capability-lab__event">
            <span>最近事件</span>
            <code>{lastEvent}</code>
          </div>
          <Typography.Text className="inspector-label" type="secondary">
            当前传输协议
          </Typography.Text>
          <pre>{JSON.stringify(observedRequest, null, 2)}</pre>
        </Card>
      </div>
    </div>
  );
}
