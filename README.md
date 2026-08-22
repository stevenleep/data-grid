# @huiyun/data-grid

面向 React Admin 的协议驱动 Data Grid。核心状态机不依赖 React、Ant Design 和 CSS；默认渲染层使用 Ant Design 6，并提供开箱即用的工具栏、表格、统计与分页布局。

它不是 Canvas 表格，也不试图处理百万行前端数据。它以服务端分页为默认路径，重点解决后台列表中反复出现的字段、查询、权限、选择、动作、编辑、视图与数据源接入问题。

在线演示：[huiyun-data-grid-demo.vercel.app](https://huiyun-data-grid-demo.vercel.app)

## 特性

- 语义字段 `GridField` 与展示列 `GridColumn` 分离，支持嵌套字段、计算字段、分组表头和纯展示列。
- local、remote、controlled 三种显式数据源；remote 请求支持取消、latest-wins、去重、缓存、旧数据保留和页码纠正。
- UI 查询自动编译为不含临时 id 的传输协议；字段可分别声明 filter、sort、select key。
- offset 分页优先，同时支持服务端 cursor 分页、未知总数和估算总数。
- 嵌套筛选、多字段排序、搜索、投影、汇总、facets、跨页选择和 all-matching 选择。
- 集中管理异步动作、单元格编辑、校验、乐观更新、失败回滚和加载错误。
- 命名视图、列宽/顺序/显隐/固定、密度与可替换的持久化协议。
- 完整受控或按 slice 受控；核心实例稳定，React 订阅按 selector 更新。
- 默认组件只是官方配方，所有工具栏、面板、表格、页脚和单元格均可独立组合。
- ESM、CommonJS、TypeScript declarations 与独立样式文件；支持按层级导入。

## 完整文档

README 只保留概览和核心示例。完整接入说明位于 [docs/README.md](./docs/README.md)：

- [快速开始](./docs/getting-started.md)
- [架构与设计原则](./docs/architecture.md)
- [字段、列与值类型](./docs/definition.md)
- [数据源](./docs/data-sources.md)
- [查询与传输协议](./docs/query-protocol.md)
- [CRUD 与交互](./docs/interactions-and-crud.md)
- [自由组合](./docs/composition.md)
- [状态、视图与持久化](./docs/state-and-persistence.md)
- [性能与生产建议](./docs/performance.md)
- [API 索引](./docs/api-reference.md)
- [故障排查](./docs/troubleshooting.md)

## 环境与安装

- React 18+
- Ant Design 6
- Node.js 18+

```bash
pnpm add @huiyun/data-grid antd @ant-design/icons
```

在应用入口导入一次样式：

```ts
import '@huiyun/data-grid/style.css';
```

## 交互 Demo

仓库内提供了一个完整的 Vite Demo，包含可执行的订单 CRUD 工作台和自由组合配方。新增、详情、表单编辑、删除、复制、筛选、排序、搜索、分页、字段设置、命名视图、行/值点击、跨页选择、批量操作、汇总、单元格快捷编辑、持久化及远程请求协议都可以直接操作。

```bash
pnpm install
pnpm demo
```

生产构建可用 `pnpm demo:build` 单独验证。

行点击与字段值点击使用 Data Grid 自己的语义上下文，不需要业务反查列配置。按钮、链接、复选框和输入控件不会误触发行点击：

```tsx
<DataGrid<Order>
  definition={definition}
  source={source}
  rowActions={{ maxVisible: 3, width: 240 }}
  onRowClick={({ row }) => openOrder(row)}
  isCellClickable={({ field }) => field?.id === 'orderNo'}
  onCellClick={({ row, field, value, event }) => {
    event.stopPropagation();
    openFieldValue({ row, field, value });
  }}
/>
```

## 快速开始

```tsx
import { DataGrid, createRemoteSource, defineGrid } from '@huiyun/data-grid';

interface Order {
  id: string;
  orderNo: string;
  customer: { id: string; name: string };
  amount: string;
  status: 'pending' | 'completed';
  createdAt: string;
}

const definition = defineGrid<Order>({
  id: 'orders',
  revision: 1,
  rowKey: 'id',
  defaults: {
    pageSize: 20,
    density: 'compact',
    selection: true,
    views: true,
  },
  fields: [
    {
      id: 'orderNo',
      title: '订单号',
      path: ['orderNo'],
      filter: true,
      sort: true,
      column: { width: 160, fixed: 'left' },
    },
    {
      id: 'customer',
      title: '客户',
      valueType: 'relation',
      path: ['customer'],
      transport: { filterKey: 'customer_id', selectKey: 'customer' },
      filter: true,
      options: {
        dependsOn: ['status'],
        cacheTime: 60_000,
        load: async ({ search, signal }) => {
          const items = await searchCustomers(search, signal);
          return items.map((item) => ({ label: item.name, value: item.id }));
        },
      },
    },
    {
      id: 'amount',
      title: '金额',
      valueType: 'money',
      path: ['amount'],
      meta: { currency: 'CNY' },
      filter: true,
      sort: true,
    },
    {
      id: 'status',
      title: '状态',
      valueType: 'status',
      filter: true,
      options: [
        { label: '待处理', value: 'pending', color: 'gold' },
        { label: '已完成', value: 'completed', color: 'green' },
      ],
    },
    {
      id: 'createdAt',
      title: '创建时间',
      valueType: 'dateTime',
      filter: true,
      sort: true,
    },
  ],
});

const source = createRemoteSource<Order>({
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
    cacheTime: 60_000,
    staleTime: 5_000,
    maxCacheEntries: 20,
  },
  read: async ({ request, signal }) => {
    const response = await queryOrders(request, { signal });
    return {
      rows: response.items,
      total: { value: response.total, accuracy: 'exact' },
      summary: response.summary,
      facets: response.facets,
    };
  },
});

export function OrderList() {
  return <DataGrid definition={definition} source={source} />;
}
```

`request` 已经是传输层查询，不需要业务再次遍历字段进行转换。它包含 pagination、keyword、递归 filter、sort、select 和可选 context，字段名均已按 `transport` 转换。

## 字段与列

字段描述数据语义，列描述表格布局。一个字段可以没有列；一个列可以是分组、计算展示或平台专用列。

```tsx
const definition = defineGrid<Order>({
  id: 'grouped-orders',
  rowKey: 'id',
  fields: [
    { id: 'orderNo', title: '订单号', sort: true },
    {
      id: 'customerName',
      title: '客户名称',
      accessor: (row) => row.customer.name,
      transport: { filterKey: 'customer_name' },
      filter: true,
    },
  ],
  columns: [
    {
      id: 'baseInfo',
      title: '基本信息',
      children: [
        { id: 'numberColumn', fieldId: 'orderNo', width: 160 },
        { id: 'customerColumn', fieldId: 'customerName', width: 220 },
      ],
    },
    {
      id: 'operationsHint',
      title: '说明',
      render: ({ row }) => <span>{row.status === 'completed' ? '已归档' : '处理中'}</span>,
    },
  ],
});
```

内置 value type：`text`、`longText`、`number`、`decimal`、`money`、`percent`、`boolean`、`select`、`multiSelect`、`status`、`date`、`dateTime`、`duration`、`link`、`email`、`phone`、`user`、`relation`、`image`、`file`、`json`。

未知 value type 会回退到 text 行为；通过 `definition.valueTypes` 可注册 codec、比较、搜索、筛选、渲染与编辑行为。

## 数据源

### Local

适合设置页和小数据列表，执行同一套筛选、搜索、排序和 offset 分页语义。

```tsx
<DataGrid definition={definition} source={createLocalSource(rows)} />
```

### Remote

`read` 获得 UI query、编译后的 request、字段、`AbortSignal`、请求 id 和请求原因。查询变化会取消旧请求，迟到结果不会覆盖新结果。

```ts
const source = createRemoteSource<Order>(
  async ({ request, signal, reason }) => api.orders.list(request, { signal, reason }),
  {
    capabilities: { sort: { max: 2 }, filter: { logic: 'and' } },
    policy: { keepPreviousData: true },
  },
);
```

### Controlled

已有 React Query、SWR、路由 loader 或业务数据层时，由外部提供结果和加载状态：

```tsx
const source = createControlledSource<Order>({
  result: {
    rows: query.data?.items ?? [],
    total: query.data ? { value: query.data.total, accuracy: 'exact' } : undefined,
  },
  loading: query.isLoading,
  refreshing: query.isFetching && !query.isLoading,
  error: query.error,
  capabilities,
  onQueryChange: (_uiQuery, request, event) => {
    setRequest(request);
    audit(event);
  },
});

<DataGrid definition={definition} source={source} />;
```

数据源只声明真实支持的能力。组件会同步限制筛选器和排序器，并在发出请求前再次校验，避免 UI 构造出后端无法执行的查询。

## 自由组合

`DataGrid` 的默认布局只是由公共原子组件组成的配方。传入 children 即完全接管布局，同时复用同一个实例和所有状态能力：

```tsx
<DataGrid definition={definition} source={source}>
  {(instance) => (
    <GridShell aria-label="订单列表">
      <MyHeader instance={instance} />
      <GridToolbar
        start={
          <>
            <GridViewTrigger<Order> />
            <GridFilterTrigger<Order> />
            <GridSortTrigger<Order> />
            <GridSearch<Order> />
          </>
        }
        end={<GridActions<Order> placement="toolbar" />}
      />
      <GridActiveFilters<Order> />
      <GridStatus<Order> />
      <GridTable<Order> rowActions={{ maxVisible: 2 }} />
      <GridFooter
        start={<GridSummary<Order> />}
        end={<GridPagination<Order> showQuickJumper={false} />}
      />
    </GridShell>
  )}
</DataGrid>
```

更底层的集成可直接使用：

```tsx
const instance = useGrid({ definition, source });

<GridProvider value={instance}>
  <GridUiProvider value={{ language: 'zh-CN' }}>
    <GridTable<Order> />
  </GridUiProvider>
</GridProvider>;
```

`GridFilterBuilder`、`GridSortBuilder` 和 `GridColumnPanel` 均支持 value/state + onChange，可放入业务自己的 Drawer、Modal 或页面区域。组件 props 类型全部公开。

## Slice 受控

`state` 可以只控制某些 slice。调用实例 API 时，组件发出期望状态，但受控值在父组件接受前保持不变。

```tsx
const [query, setQuery] = useState<GridQuery>(initialQuery);

<DataGrid
  definition={definition}
  source={source}
  state={{ query }}
  onStateChange={(next, event) => {
    if (event.type.startsWith('query.')) setQuery(next.query);
  }}
/>;
```

可控制的 slice 为 `query`、`columns`、`selection`、`data`、`views`、`editing`、`actions`。通常只控制业务必须拥有的 slice，其余交给实例管理即可。

## Actions、选择与编辑

动作定义统一覆盖 toolbar、row、bulk 和 cell，自动处理 visible、disabled、确认框、并发保护、错误与刷新：

```tsx
const definition = defineGrid<Order>({
  // fields, rowKey...
  actions: [
    {
      id: 'create',
      label: '新建订单',
      intent: 'primary',
      placement: 'toolbar',
      run: () => openCreateOrder(),
    },
    {
      id: 'archive',
      label: '归档',
      placement: 'row',
      getConfirmation: ({ row }) => (row ? `确认归档 ${row.orderNo}？` : undefined),
      disabled: ({ row }) => row?.status === 'completed',
      refresh: true,
      run: ({ row, signal }) => archiveOrder(row!.id, signal),
    },
  ],
});
```

显式选择会保留跨页 key 和已知行；all-matching 使用“查询签名 + 排除 key”表达，不会把所有 id 拉到浏览器。

编辑由 definition 统一保存，字段只声明是否可编辑：

```tsx
const definition = defineGrid<Order>({
  // ...
  fields: [
    {
      id: 'status',
      title: '状态',
      valueType: 'status',
      edit: { enabled: true, required: true },
      options: statusOptions,
    },
  ],
  editing: {
    optimistic: true,
    apply: (row, field, value) => ({ ...row, [field.id]: value }),
    save: async ({ rowKey, field, value, signal }) => {
      return updateOrder(rowKey, { [field.transport.selectKey]: value }, signal);
    },
  },
});
```

返回更新后的 row 会直接替换当前页；返回 `{ type: 'grid-edit-result', row, reload }` 可精确控制；返回空值默认刷新。取消或失败时乐观更新会回滚。

## 视图与持久化

```tsx
<DataGrid
  definition={definition}
  source={source}
  persistence={createLocalGridPersistence({ scope: currentUser.id })}
/>
```

`GridPersistence` 是异步协议，可替换为服务端存储。持久化内容包含 protocol、grid id、definition revision、列状态、视图和 active view。revision 改变时仅在提供 `migrate` 后恢复，避免旧字段配置污染新版本。

## JSON 协议与运行时绑定

服务端下发的 schema 只包含 JSON-safe 数据；函数、React 节点和权限逻辑通过稳定名称绑定：

```tsx
const schema = defineGridSchema({
  protocol: 'huiyun.data-grid/v1',
  id: 'users',
  revision: 3,
  fields: [
    {
      id: 'owner',
      title: '负责人',
      valueType: 'user',
      path: ['owner'],
      filter: true,
      options: { type: 'runtime', loader: 'users', cacheTime: 60_000 },
      renderer: 'ownerCell',
    },
  ],
  actions: [{ id: 'export', label: '导出', handler: 'exportUsers', placement: 'toolbar' }],
});

const runtime = defineGridRuntime<User>({
  optionLoaders: {
    users: ({ search, signal }) => loadUserOptions(search, signal),
  },
  renderers: {
    ownerCell: ({ value }) => <UserCell value={value} />,
  },
  actionHandlers: {
    exportUsers: ({ request }) => exportUsers(request),
  },
});

const definition = bindGridSchema(schema, runtime, 'id');

<DataGrid definition={definition} source={source} />;
```

引用了不存在的 renderer、editor、option loader、column header 或 action handler 时会立即报错，而不是在用户打开面板后静默失败。

## 分层导入

```ts
import { createGrid, compileGridQuery } from '@huiyun/data-grid/core';
import { GridProvider, useGrid, useGridSelector } from '@huiyun/data-grid/react';
import { DataGrid, GridTable } from '@huiyun/data-grid/antd';
import '@huiyun/data-grid/style.css';
```

- `@huiyun/data-grid/core`：纯 TypeScript，无 React、Ant Design、DOM 和 CSS 依赖。
- `@huiyun/data-grid/react`：实例生命周期、Provider 和 selector 订阅。
- `@huiyun/data-grid/antd`：Ant Design 6 原子组件与默认配方。
- 根入口：便捷导出以上公共 API。

## 明确边界

当前包有意不包含 Canvas 渲染、百万行前端模式、公式引擎、透视表、实时协同和 Excel 级区域选择。大量数据应由后端查询与分页处理；如需极端行数渲染，可在同一个 core instance 上实现独立 renderer，而不改变查询和业务协议。

## 开发与发布检查

```bash
pnpm install
pnpm check
pnpm pack:check
```

`definition.id` 必须稳定；当字段、列或运行时行为发生不兼容变更时提升 `revision`。发布前建议同时对根入口和 `/core`、`/react`、`/antd` 子路径做消费端 smoke test。

## License

MIT
