import {
  ApiOutlined,
  AppstoreOutlined,
  CodeOutlined,
  DatabaseOutlined,
  FunctionOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Alert, Card, Col, Row, Space, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';

const quickStart = `import {
  DataGrid,
  createFieldHelper,
  createRemoteSource,
  defineGrid,
} from '@stevenleep/data-grid';
import '@stevenleep/data-grid/style.css';

const field = createFieldHelper<Order>();
const definition = defineGrid<Order>({
  id: 'orders',
  rowKey: 'id',
  fields: [
    field.property('orderNo', { title: '订单号', filter: true, sort: true }),
    field.property('amount', { title: '金额', valueType: 'money', sort: true }),
    field.property('status', { title: '状态', valueType: 'status', filter: true }),
  ],
});

const source = createRemoteSource<Order>({
  capabilities: { pagination: 'offset', search: true },
  read: ({ request, signal }) => api.orders.list(request, { signal }),
});

export const OrderList = () => (
  <DataGrid definition={definition} source={source} />
);`;

const interactionCode = `<DataGrid<Order>
  definition={definition}
  source={source}
  rowActions={{ maxVisible: 2, width: 172 }}
  onRowClick={({ row }) => openDetail(row)}
  isCellClickable={({ field }) => field?.id === 'orderNo'}
  onCellClick={({ row, value, event }) => {
    event.stopPropagation();
    openValue(row, value);
  }}
/>`;

const remoteCode = `read: async ({ request, signal, reason }) => {
  const response = await api.orders.list(request, { signal });
  return {
    rows: response.items,
    total: { value: response.total, accuracy: 'exact' },
    summary: response.summary,
    facets: response.facets,
  };
}`;

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="docs-code">
      <code>{children}</code>
    </pre>
  );
}

function LayerCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: string;
}) {
  return (
    <Card size="small" className="docs-layer-card">
      <div className="docs-layer-icon">{icon}</div>
      <Typography.Title level={5}>{title}</Typography.Title>
      <Typography.Paragraph type="secondary">{children}</Typography.Paragraph>
    </Card>
  );
}

const navigation = [
  ['docs-overview', '文档总览'],
  ['docs-start', '快速开始'],
  ['docs-architecture', '分层架构'],
  ['docs-source', '远程数据源'],
  ['docs-interaction', 'CRUD 与交互'],
  ['docs-reference', '专题文档'],
];

export function DocsPanel() {
  return (
    <div className="docs-panel">
      <aside className="docs-sidebar">
        <div className="docs-sidebar-kicker">DOCUMENTATION</div>
        <Typography.Title level={4}>开发文档</Typography.Title>
        <Typography.Paragraph type="secondary">
          从业务接入到平台封装，按真实决策路径组织。
        </Typography.Paragraph>
        <nav aria-label="文档目录">
          {navigation.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </nav>
        <div className="docs-sidebar-path">
          <span>仓库文档</span>
          <code>docs/README.md</code>
        </div>
      </aside>

      <article className="docs-article">
        <section id="docs-overview" className="docs-section docs-intro">
          <div className="docs-eyebrow">
            <ThunderboltOutlined /> START HERE
          </div>
          <Typography.Title level={2}>协议驱动的 Admin Data Grid</Typography.Title>
          <Typography.Paragraph>
            默认配方负责常规后台列表，Headless Core
            负责查询、状态、动作和数据源。业务可以先用完整组件，在出现特殊布局时再按层拆解，不需要重写协议。
          </Typography.Paragraph>
          <Space wrap>
            <Tag color="blue">服务端分页优先</Tag>
            <Tag color="geekblue">字段语义与列分离</Tag>
            <Tag color="cyan">完整 CRUD</Tag>
            <Tag color="purple">自由组合</Tag>
          </Space>
        </section>

        <section id="docs-start" className="docs-section">
          <Typography.Title level={3}>快速开始</Typography.Title>
          <Alert
            type="info"
            showIcon
            title="安装"
            description={
              <code>pnpm add @stevenleep/data-grid react react-dom antd @ant-design/icons</code>
            }
          />
          <CodeBlock>{quickStart}</CodeBlock>
        </section>

        <section id="docs-architecture" className="docs-section">
          <Typography.Title level={3}>分层架构</Typography.Title>
          <Row gutter={12}>
            <Col xs={24} md={8}>
              <LayerCard icon={<FunctionOutlined />} title="Core">
                纯 TypeScript 状态机、查询编译、数据源、动作、编辑和视图。
              </LayerCard>
            </Col>
            <Col xs={24} md={8}>
              <LayerCard icon={<AppstoreOutlined />} title="React">
                实例生命周期、Provider、事件和细粒度 selector 订阅。
              </LayerCard>
            </Col>
            <Col xs={24} md={8}>
              <LayerCard icon={<ApiOutlined />} title="Ant Design 6">
                默认完整配方、工具栏、构造器、表格、单元格和页脚。
              </LayerCard>
            </Col>
          </Row>
        </section>

        <section id="docs-source" className="docs-section">
          <Typography.Title level={3}>远程数据源</Typography.Title>
          <Typography.Paragraph type="secondary">
            查询变化自动取消旧请求；迟到结果不会覆盖新结果。编译后的 request 可以直接交给后端。
          </Typography.Paragraph>
          <CodeBlock>{remoteCode}</CodeBlock>
        </section>

        <section id="docs-interaction" className="docs-section">
          <Typography.Title level={3}>CRUD 与语义交互</Typography.Title>
          <Typography.Paragraph type="secondary">
            行点击和值点击都拿到完整语义上下文；Grid 操作按钮、输入框和选择控件不会误触发行点击。
          </Typography.Paragraph>
          <CodeBlock>{interactionCode}</CodeBlock>
        </section>

        <section id="docs-reference" className="docs-section">
          <Typography.Title level={3}>专题文档</Typography.Title>
          <div className="docs-topic-grid">
            {[
              ['getting-started.md', '安装、定义和第一个远程列表'],
              ['definition.md', '字段、列、值类型和动态选项'],
              ['data-sources.md', 'Local、Remote 与 Controlled'],
              ['query-protocol.md', '搜索、筛选、排序与分页协议'],
              ['interactions-and-crud.md', 'CRUD、批量动作和快捷编辑'],
              ['composition.md', '默认配方与完全自由组合'],
              ['state-and-persistence.md', '受控状态、视图和迁移'],
              ['performance.md', '生产性能与请求效率'],
              ['api-reference.md', '公共 API 完整索引'],
              ['troubleshooting.md', '常见问题与发布检查'],
            ].map(([file, description]) => (
              <div className="docs-topic" key={file}>
                <DatabaseOutlined />
                <div>
                  <code>{file}</code>
                  <span>{description}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="docs-package-note">
            <CodeOutlined /> 文档目录会随 npm 包一起发布，安装后可以直接查看。
          </div>
        </section>
      </article>
    </div>
  );
}
