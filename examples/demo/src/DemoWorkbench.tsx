import {
  CheckCircleOutlined,
  CloudServerOutlined,
  CodeOutlined,
  ExperimentOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Button, Card, Flex, Space, Statistic, Tabs, Tag, Typography } from 'antd';
import { useEffect } from 'react';
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
  useGridInstance,
  useGridSelector,
  type DataGridProps,
  type GridDataSource,
  type GridDefinition,
  type GridInstance,
  type GridPersistence,
  type GridRequestQuery,
} from '@stevenleep/data-grid';
import { CapabilityLab } from './CapabilityLab';
import { DocsPanel } from './DocsPanel';
import type { DemoOrder } from './data';

export interface ActivityItem {
  id: string;
  text: string;
  time: string;
}

export type OrderGridInteractions = Pick<
  DataGridProps<DemoOrder>,
  'onRowClick' | 'onCellClick' | 'isCellClickable' | 'onEvent'
>;

interface GridRecipe {
  definition: GridDefinition<DemoOrder>;
  source: GridDataSource<DemoOrder>;
}

interface DemoWorkbenchProps {
  total: number;
  requests: number;
  primary: GridRecipe & {
    session: number;
    persistence: GridPersistence<DemoOrder>;
    capture: (instance?: GridInstance<DemoOrder>) => void;
  };
  composed: GridRecipe;
  activity: readonly ActivityItem[];
  lastRequest?: GridRequestQuery;
  resetting: boolean;
  interactions: OrderGridInteractions;
  onCreate: () => void;
  onReset: () => void;
  onError: (error: Error) => void;
}

function GridInstanceCapture({
  onInstance,
}: {
  onInstance: (instance?: GridInstance<DemoOrder>) => void;
}) {
  const instance = useGridInstance<DemoOrder>();
  useEffect(() => {
    onInstance(instance);
    return () => onInstance(undefined);
  }, [instance, onInstance]);
  return null;
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
      <Statistic title="验收能力" value={18} suffix="项" />
    </div>
  );
}

function CompleteWorkbench({
  primary,
  activity,
  lastRequest,
  resetting,
  interactions,
  onCreate,
  onReset,
  onError,
}: Pick<
  DemoWorkbenchProps,
  | 'primary'
  | 'activity'
  | 'lastRequest'
  | 'resetting'
  | 'interactions'
  | 'onCreate'
  | 'onReset'
  | 'onError'
>) {
  return (
    <div className="demo-stage demo-stage--with-inspector">
      <div className="demo-grid-column" data-testid="demo-complete-grid">
        <div className="stage-heading">
          <div>
            <Typography.Title level={3}>订单管理</Typography.Title>
            <Typography.Text type="secondary">
              单击行查看详情；点击订单号或客户值验证值事件；双击状态可快捷编辑。
            </Typography.Text>
          </div>
          <Space>
            <Button type="primary" icon={<ThunderboltOutlined />} onClick={onCreate}>
              快捷新建
            </Button>
            <Button icon={<ReloadOutlined />} loading={resetting} onClick={onReset}>
              恢复出厂
            </Button>
          </Space>
        </div>
        <div className="acceptance-guide" aria-label="工作台验收路径">
          <div>
            <strong>查询与视图</strong>
            <span>搜索 · 嵌套过滤 · 多字段排序 · 字段设置 · 命名视图</span>
          </div>
          <div>
            <strong>数据操作</strong>
            <span>新增 · 详情 · 表单编辑 · 快捷编辑 · 复制 · 删除 · CSV 导出</span>
          </div>
          <div>
            <strong>交互与批量</strong>
            <span>分页 · 行/值点击 · 跨页选择 · All matching · 批量动作 · 汇总</span>
          </div>
        </div>
        <DataGrid<DemoOrder>
          key={primary.session}
          definition={primary.definition}
          source={primary.source}
          persistence={primary.persistence}
          pageSizeOptions={[10, 20, 50]}
          className="demo-grid"
          beforeTable={<GridInstanceCapture onInstance={primary.capture} />}
          rowActions={{ maxVisible: 2, width: 172 }}
          tableProps={{ scroll: { y: 430 } }}
          onError={onError}
          {...interactions}
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
  );
}

function ComposedWorkbench({
  recipe,
  interactions,
  onError,
}: {
  recipe: GridRecipe;
  interactions: OrderGridInteractions;
  onError: (error: Error) => void;
}) {
  return (
    <div className="demo-stage" data-testid="demo-composed-grid">
      <DataGrid<DemoOrder>
        definition={recipe.definition}
        source={recipe.source}
        pageSizeOptions={[10, 20, 50]}
        onError={onError}
        {...interactions}
      >
        {() => (
          <GridShell className="demo-grid demo-grid--composed">
            <GridActions<DemoOrder> placement="toolbar" />
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
  );
}

export function DemoWorkbench(props: DemoWorkbenchProps) {
  return (
    <>
      <header className="demo-hero">
        <div>
          <div className="demo-eyebrow">
            <ExperimentOutlined /> INTERACTIVE PACKAGE DEMO
          </div>
          <Typography.Title level={1}>@stevenleep/data-grid</Typography.Title>
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
        <DemoMetrics total={props.total} requests={props.requests} />
      </header>

      <section className="demo-content">
        <Tabs
          size="large"
          more={{ icon: '更多', trigger: 'click' }}
          items={[
            {
              key: 'complete',
              label: '完整业务工作台',
              children: <CompleteWorkbench {...props} />,
            },
            { key: 'capabilities', label: '数据源与状态', children: <CapabilityLab /> },
            {
              key: 'composed',
              label: '自由组合',
              children: (
                <ComposedWorkbench
                  recipe={props.composed}
                  interactions={props.interactions}
                  onError={props.onError}
                />
              ),
            },
            { key: 'docs', label: '开发文档', children: <DocsPanel /> },
          ]}
        />
      </section>

      <footer className="demo-page-footer">
        <span>pnpm demo</span>
        <span>·</span>
        <span>所有数据与网络请求均在浏览器本地模拟</span>
      </footer>
    </>
  );
}
