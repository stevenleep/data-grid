# 数据源

数据源决定数据由谁持有以及查询在哪里执行。三种模式共享同一套字段、查询、表格和动作能力。

## Local

适合字典、配置页和较小数据集。搜索、筛选、排序和 offset 分页在浏览器执行。

```tsx
const source = createLocalSource(rows, {
  pagination: 'offset',
  search: true,
  filter: { logic: 'nested' },
  sort: { max: 3 },
});

<DataGrid definition={definition} source={source} />;
```

Local 与 Remote 使用同一个查询执行器，适合在没有接口时开发页面和测试协议，但不应用它承载大数据量。

## Remote

Remote 是后台管理列表的默认选择。

```ts
const source = createRemoteSource<Order>({
  capabilities,
  policy: {
    keepPreviousData: true,
    staleTime: 5_000,
    cacheTime: 60_000,
    maxCacheEntries: 20,
  },
  read: async ({ query, request, fields, signal, requestId, reason }) => {
    const response = await api.orders.list(request, { signal });
    return {
      rows: response.items,
      total: { value: response.total, accuracy: 'exact' },
      pageInfo: response.pageInfo,
      summary: response.summary,
      facets: response.facets,
      snapshotId: response.snapshotId,
      meta: response.meta,
    };
  },
});
```

### read 输入

- `query`：包含临时节点 id 的 UI 查询状态。
- `request`：可直接发给后端的稳定传输协议。
- `fields`：已解析字段。
- `signal`：新请求、停止实例或销毁实例时会取消。
- `requestId`：单调递增的请求编号。
- `reason`：`initial`、`query`、`pagination`、`refresh`、`projection` 或 `source`。

### 竞争与缓存

- 查询变化会取消前一个请求。
- 即使接口忽略取消，迟到结果也不会覆盖新结果。
- 相同请求签名会去重。
- `staleTime` 内直接使用新鲜缓存；`cacheTime` 控制缓存寿命。
- `keepPreviousData` 在翻页和刷新时保留旧行，避免表格闪空。

## Controlled

当数据已经由 React Query、SWR、路由 Loader 或业务 Store 管理时使用。

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
  onQueryChange: (_query, request, event) => {
    setRequest(request);
    audit(event);
  },
});
```

Controlled 模式不会自行请求；组件只发出查询变化并渲染外部结果。

## 能力声明

```ts
const capabilities = {
  pagination: 'offset',
  search: true,
  filter: {
    logic: 'nested',
    negation: true,
    maxDepth: 3,
    maxConditions: 20,
    operators: ['equals', 'in', 'between'],
  },
  sort: { max: 3, nulls: true },
  projection: true,
  summary: true,
  facets: true,
  selectAllMatching: true,
} satisfies GridCapabilities;
```

声明必须与后端真实能力一致。UI 会据此限制构造器，Core 在发请求前再次校验。

## 返回总数

- `exact`：精确总数，可展示完整页码。
- `estimated`：估算总数，应在 UI 中标识。
- `atLeast`：至少有这么多，适合代价较高的计数。
- 不返回 `total`：配合 `pageInfo.hasNext` 使用 cursor 或未知总数分页。
