# 状态、视图与持久化

## 状态分片

| Slice       | 内容                                   |
| ----------- | -------------------------------------- |
| `query`     | 分页、搜索、筛选、排序、投影和 context |
| `columns`   | 顺序、显隐、宽度、固定和密度           |
| `selection` | 显式选择或 all-matching 选择           |
| `data`      | 行、总数、汇总、facets、请求状态和错误 |
| `views`     | 命名视图、当前视图和 dirty 状态        |
| `editing`   | 当前编辑单元格、草稿、保存状态和错误   |
| `actions`   | 动作 pending 与错误                    |

## 默认状态

```tsx
<DataGrid
  defaultState={{
    query: {
      keyword: '',
      sorts: [{ id: 'created', fieldId: 'createdAt', direction: 'desc' }],
      pagination: { type: 'offset', page: 1, pageSize: 50 },
    },
    columns: { hidden: ['internalRemark'] },
  }}
/>
```

## Slice 受控

```tsx
const [query, setQuery] = useState(initialQuery);

<DataGrid
  definition={definition}
  source={source}
  state={{ query }}
  onStateChange={(next, event) => {
    if (event.type.startsWith('query.')) setQuery(next.query);
  }}
/>;
```

只控制业务必须拥有的 slice。完全控制所有 slice 会增加同步成本，也更容易制造过期状态。

## Selector 订阅

```tsx
const selectedCount = useGridSelector<Order, number>((state) =>
  state.selection.mode === 'explicit'
    ? state.selection.selectedKeys.length
    : state.selection.total - state.selection.excludedKeys.length,
);
```

selector 应返回稳定的标量或使用自定义 equality，避免每次创建新对象导致无意义更新。

## 事件

```tsx
<DataGrid
  onEvent={(event, state) => {
    if (event.reason === 'user') analytics.track(event.type, event.detail);
  }}
/>
```

事件包含 `type`、`reason`、`timestamp` 和可选 `detail`。reason 为 `user`、`api`、`source`、`restore` 或 `system`。

## 命名视图

视图保存不含分页的 query 和完整列状态。实例 API：

```ts
instance.views.create('我的待办', 'private');
instance.views.save(viewId);
instance.views.apply(viewId);
instance.views.rename(viewId, '高风险待办');
instance.views.duplicate(viewId);
instance.views.remove(viewId);
```

readonly 视图不可保存或删除；对当前视图修改 query/columns 后 `dirty` 为 true。

## 本地持久化

```tsx
<DataGrid
  persistence={createLocalGridPersistence({
    scope: currentUser.id,
    storage: window.localStorage,
  })}
/>
```

不同用户、租户或页面环境应使用不同 scope。

本地 adapter 会拒绝损坏或结构不完整的 JSON，也会安全处理浏览器禁止访问 storage 的情况。它仍然是明文 `localStorage`：命名视图会保存筛选值和 query context，因此不要把密钥、身份证号、访问令牌或其他敏感数据放进可持久化查询。涉及敏感字段、共享视图、审计、权限或多端同步时，应使用服务端 adapter，并在服务端执行字段级过滤、授权和版本控制。

## 服务端持久化

```ts
const persistence: GridPersistence<Order> = {
  load: (gridId) => api.gridPreferences.get(gridId),
  save: (gridId, state) => api.gridPreferences.put(gridId, state),
  clear: (gridId) => api.gridPreferences.remove(gridId),
  migrate: (state, { definition }) => migratePreference(state, definition.revision),
};
```

持久化协议包含 grid id、revision、列状态、命名视图、active view 和更新时间。revision 不匹配时，只有提供 `migrate` 才会恢复。

`shared` / `system` 是视图协议中的 scope，不代表客户端自动获得协作能力。服务端实现仍需定义创建、更新、删除权限，使用版本号或 ETag 处理并发冲突，并对只读视图强制授权；不要只依赖前端按钮隐藏。
