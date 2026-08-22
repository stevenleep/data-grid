# 快速开始

## 环境要求

- Node.js 18+
- React 18+
- Ant Design 6
- TypeScript 5 推荐但不是运行时必需

```bash
pnpm add @huiyun/data-grid antd @ant-design/icons
```

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
import { defineGrid } from '@huiyun/data-grid';

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
  fields: [
    {
      id: 'orderNo',
      title: '订单号',
      filter: true,
      sort: true,
      column: { width: 160, fixed: 'left' },
    },
    {
      id: 'customer',
      title: '客户',
      valueType: 'relation',
      accessor: (row) => row.customer,
      searchText: (value) => value.name,
      transport: { filterKey: 'customer_id' },
      filter: true,
      options: customerOptions,
    },
    {
      id: 'amount',
      title: '金额',
      valueType: 'money',
      filter: true,
      sort: true,
      meta: { currency: 'CNY' },
    },
    {
      id: 'status',
      title: '状态',
      valueType: 'status',
      filter: true,
      options: statusOptions,
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
```

字段默认会生成同名展示列。只有需要分组表头、纯展示列或一个字段多种展示时，才需要显式声明 `columns`。

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
      pageSizeOptions={[20, 50, 100]}
      onError={(error) => notification.error({ message: error.message })}
    />
  );
}
```

默认配方已经包含视图、字段设置、筛选、排序、搜索、工具栏动作、表格、汇总、总数和分页。

## 运行仓库 Demo

```bash
pnpm install
pnpm demo
```

Demo 包含真实可操作的新增、查看、编辑、删除、复制、筛选、排序、分页、批量动作、行点击和值点击。
