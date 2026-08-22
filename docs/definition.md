# 字段、列与值类型

## 字段负责语义

`GridFieldDefinition` 描述数据如何读取、筛选、排序、搜索、编辑、验证和传输。

```tsx
{
  id: 'customer',
  title: '客户',
  valueType: 'relation',
  accessor: (row) => row.customer,
  normalize: (value) => normalizeCustomer(value),
  searchText: (value) => value.name,
  filter: { enabled: true },
  sort: false,
  edit: { enabled: true, required: true },
  transport: {
    filterKey: 'customer_id',
    sortKey: 'customer_name',
    selectKey: 'customer',
    encodeValue: (value) => value.id,
  },
  options: customerOptions,
}
```

取值优先级为 `accessor` → `path` → 与 `id` 同名路径。复杂或计算字段使用 `accessor`，普通字段通常只写 `id` 即可。

## 列负责展示

```tsx
columns: [
  {
    id: 'identity',
    title: '订单信息',
    children: [
      { id: 'numberColumn', fieldId: 'orderNo', width: 160, fixed: 'left' },
      { id: 'customerColumn', fieldId: 'customer', width: 220 },
    ],
  },
  {
    id: 'hint',
    title: '提示',
    render: ({ row }) => <OrderHint order={row} />,
  },
];
```

字段可以没有列，用于隐藏筛选条件或接口投影；列也可以没有字段，用于业务展示和操作提示。

## 内置值类型

| 类别 | valueType                                           |
| ---- | --------------------------------------------------- |
| 文本 | `text`、`longText`、`link`、`email`、`phone`        |
| 数值 | `number`、`decimal`、`money`、`percent`、`duration` |
| 选项 | `select`、`multiSelect`、`status`、`boolean`        |
| 日期 | `date`、`dateTime`                                  |
| 实体 | `user`、`relation`                                  |
| 资源 | `image`、`file`                                     |
| 结构 | `json`                                              |

每个值类型提供默认宽度、操作符、codec、空值判断、比较、渲染和编辑器。通过 `definition.valueTypes` 可注册自定义类型。

## 静态和动态选项

静态选项：

```ts
options: [
  { label: '待处理', value: 'pending', color: 'gold' },
  { label: '已完成', value: 'completed', color: 'green' },
];
```

动态选项：

```ts
options: {
  dependsOn: ['departmentId'],
  cacheTime: 60_000,
  load: async ({ search, query, signal }) => {
    const items = await api.users.options({ search, department: query.context?.departmentId }, signal);
    return items.map((item) => ({ label: item.name, value: item.id }));
  },
}
```

实例会去重相同选项请求、缓存结果，并在依赖变化时使用新缓存键。

## 关系字段的本地筛选

如果显示值是 `{ id, name }`，而筛选值是 id，Local source 需要自定义 `filterPredicate`：

```ts
filterPredicate: (entity, condition) => {
  const targets = Array.isArray(condition.value) ? condition.value : [condition.value];
  if (condition.operator === 'containsAny') {
    return targets.some((target) => String(target) === String(entity?.id));
  }
  return undefined; // 交回内置逻辑
};
```

Remote source 只发送筛选协议，通常由后端按 `transport.filterKey` 执行。

## JSON Schema 与 Runtime

服务端下发的 `GridSchema` 必须保持 JSON-safe。函数和 React 节点通过稳定名称绑定：

```ts
const definition = bindGridSchema(schema, {
  renderers: { ownerCell: ({ value }) => <Owner value={value} /> },
  optionLoaders: { users: loadUserOptions },
  actionHandlers: { exportOrders },
}, 'id');
```

缺失 renderer、editor、loader、header 或 action handler 时会在绑定阶段立即抛错。
