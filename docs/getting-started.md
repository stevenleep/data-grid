# 快速开始

## 环境要求

- Node.js `>=20.19.0`
- React 与 React DOM 18/19，两者主版本一致
- Ant Design 与 Ant Design Icons 6
- TypeScript 5.4–7.x 推荐但不是运行时必需
- 支持 ES2020、`AbortController`、`ResizeObserver`、Pointer Events 和现代 `Intl`/IANA 时区的 evergreen 浏览器

```bash
pnpm add @huiyun/data-grid react react-dom antd @ant-design/icons
```

React、React DOM、Ant Design 和图标包都是 optional peer dependencies；使用默认 DataGrid 时需要由应用显式安装，从而避免包替业务项目决定 UI 版本。只用 `@huiyun/data-grid/core` 时可以只安装 `@huiyun/data-grid`，不需要任何 UI peer。

根入口、`/react` 和 `/antd` 自带 `"use client"` 边界，`/core` 不带该指令。Next.js App Router 中可以从服务端模块使用 `/core`；直接组合 DataGrid、业务 hooks 或浏览器 API 的应用组件仍应声明 `"use client"`。

在应用入口导入一次样式：

```ts
import '@huiyun/data-grid/style.css';
```

## 定义行数据

```ts
interface Order {
  id: number;
  orderNo: string;
  customer: { id: number; name: string };
  amount: number;
  status: 'pending' | 'completed';
  createdAt: string;
}
```

## 定义表格协议

```tsx
import { createFieldHelper, defineGrid } from '@huiyun/data-grid';

const field = createFieldHelper<Order>();
const fields = [
  field.property('orderNo', {
    title: '订单号',
    filter: true,
    sort: true,
    column: { width: 160, fixed: 'left' },
  }),
  field.property('customer', {
    title: '客户',
    valueType: 'relation',
    searchText: (value) => value.name,
    transport: { filterKey: 'customer_id' },
    filter: true,
    options: customerOptions,
  }),
  field.property('amount', {
    title: '金额',
    valueType: 'money',
    filter: true,
    sort: true,
    meta: { currency: 'CNY' },
  }),
  field.property('status', {
    title: '状态',
    valueType: 'status',
    filter: true,
    options: statusOptions,
  }),
  field.property('createdAt', {
    title: '创建时间',
    valueType: 'dateTime',
    filter: true,
    sort: true,
  }),
];

export const orderGrid = defineGrid<Order>({
  id: 'admin-orders',
  revision: 1,
  rowKey: 'id',
  defaults: {
    pageSize: 20,
    density: 'compact',
    selection: true,
    views: true,
  },
  fields,
});
```

字段默认会生成同名展示列。`createFieldHelper<Order>()` 让 `property` 的 value callback 保留 `Order[Key]`，让 `accessor` 的返回类型贯穿 codec、搜索和 renderer；不要在有 value callback 的异构 inline fields 数组里依赖 `any`。只有需要分组表头、纯展示列或一个字段多种展示时，才需要显式声明 `columns`。

## 接入服务端数据

```tsx
import { DataGrid, createRemoteSource } from '@huiyun/data-grid';

const source = createRemoteSource<Order>({
  capabilities: {
    pagination: 'offset',
    search: true,
    filter: { logic: 'nested', negation: true, maxDepth: 3, maxConditions: 20 },
    sort: { max: 3, nulls: true },
    projection: true,
    summary: true,
  },
  policy: {
    keepPreviousData: true,
    staleTime: 5_000,
    cacheTime: 60_000,
    maxCacheEntries: 20,
  },
  read: async ({ request, signal }) => {
    const response = await api.orders.list(request, { signal });
    return {
      rows: response.items,
      total: { value: response.total, accuracy: 'exact' },
      summary: response.summary,
      facets: response.facets,
    };
  },
});

export function OrderList() {
  return (
    <DataGrid
      definition={orderGrid}
      source={source}
      temporal={{ timeZone: 'Asia/Shanghai', weekStartsOn: 1 }}
      pageSizeOptions={[20, 50, 100]}
      onError={(error) => notification.error({ message: error.message })}
    />
  );
}
```

`temporal` 是 Local 数据源相对日期操作符（如 `today`、`thisWeek`）的时间语义。`timeZone` 使用 IANA 时区，默认 `UTC`；`weekStartsOn` 使用 0（周日）到 6（周六），默认 1（周一）。可在测试或可重放业务中传入 `now: () => fixedDate`；生产实时时钟应每次返回当前时间。Remote/Controlled 后端仍需定义并实现同样的时区与周起始协议。

默认配方已经包含视图、字段设置、筛选、排序、搜索、工具栏动作、表格、汇总、总数和分页。

## 运行仓库 Demo

```bash
pnpm install
pnpm demo
```

Demo 包含真实可操作的新增、查看、编辑、删除、复制、筛选、排序、分页、批量动作、行点击和值点击。
