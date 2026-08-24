# 字段、列与值类型

## 字段负责语义

`GridFieldDefinition` 描述数据如何读取、筛选、排序、搜索、编辑、验证和传输。

```tsx
const field = createFieldHelper<Order>();

const customerField = field.property('customer', {
  title: '客户',
  valueType: 'relation',
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
});
```

取值优先级为 `accessor` → `path` → 与 `id` 同名路径。复杂或计算字段使用 `accessor`，普通字段通常只写 `id` 即可。

希望保留普通属性的精确值类型时，优先使用 `createFieldHelper<Row>().property(key, options)`；它会把 `key` 同时作为字段 id/path，并把 `Row[Key]` 传给 codec、编辑器和 renderer。集合型编辑器应显式声明 `edit: { enabled: true, multiple: true }`，不要仅从 `valueType` 名称推断单值/多值。精确小数或超出 JavaScript 安全整数的输入应声明 `edit.numericMode: 'string'` 并由 codec/服务端校验；普通数值可显式使用 `'number'`。

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

### 值 codec 与传输值

codec 显式区分表格中的业务值与 JSON-safe 传输值：

```ts
const instantValueType = defineGridValueType<Order, Date>({
  codec: {
    encode: (value) => {
      if (!(value instanceof Date)) throw new Error('Expected Date');
      return value.toISOString();
    },
    decode: (value) => {
      if (typeof value !== 'string') throw new Error('Expected ISO date string');
      return new Date(value);
    },
  },
});
const field = createFieldHelper<Order>();

const definition = defineGrid<Order>({
  // ...
  valueTypes: {
    instant: instantValueType,
  },
  fields: [
    field.property('approvedAt', {
      title: '审批时间',
      valueType: 'instant',
      edit: true,
    }),
  ],
});
```

解析后的字段公开 `field.codec`、`field.encodeValue(value)` 和 `field.decodeValue(json)`。`transport.encodeValue` 可以按字段覆盖 codec 的 `encode`，例如实体对象只上传 id。编码结果必须是 `GridJsonValue | undefined`；函数、`Date`、`Map`、`NaN`、`Infinity` 和循环引用都不是合法线上值。

Core 不会自动遍历数据源返回的每行并解码；后端响应/表单 adapter 应在组装 row 时调用 `decodeValue`。编辑保存时 Core 会自动调用 `encodeValue`，并把业务值和编码值同时交给 `editing.save`。

`defineGridValueType<Row, Value>()` 用于在值类型进入异构 registry 前保留自定义 `Value` 的函数参数类型。`GridAnyValueTypeDefinition<Row>` 的类型擦除只服务于框架内部的异构存储边界；业务代码不应把 callback 标注成它或 `any`，而应通过 `defineGridValueType` 构造后再放入 `GridValueTypeRegistry<Row>`。

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
  dependsOn: 'query',
  cacheTime: 60_000,
  load: async ({ search, query, signal }) => {
    const items = await api.users.options(
      { search, department: query.context?.departmentId },
      signal,
    );
    return items.map((item) => ({ label: item.name, value: item.id }));
  },
}
```

字符串数组形式的 `dependsOn` 指筛选字段 id；这些字段的条件变化会生成新的缓存键。需要依赖 keyword、sort、context 或整个查询时使用 `dependsOn: 'query'`。

实例会去重相同选项请求、缓存结果，并在依赖变化时使用新缓存键。每个调用方都可以通过 `instance.options.load(fieldId, search, { signal })` 独立取消等待；共享同一请求的其他调用方不会受影响，全部调用方取消后才会中止底层 loader。

## 关系字段的本地筛选

内置 `relation` / `user` 会把 primitive 或对象的 `id` / `value` / `key` 当作实体身份，因此 `{ id, name }` 可以直接与 id 筛选值比较，单值和集合值都不依赖对象引用或显示文本。

业务实体使用其他身份字段时，优先声明 `getIdentity`：

```ts
getIdentity: (entity) => entity?.customerCode;
```

只有需要完全自定义某个操作符语义时才实现 `filterPredicate`，返回 `undefined` 可把未处理的操作符交回内置逻辑：

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
const schema = parseGridSchema(await api.grids.getSchema());
const definition = bindGridSchema(schema, {
  renderers: { ownerCell: ({ value }) => <Owner value={value} /> },
  optionLoaders: { users: loadUserOptions },
  actionHandlers: { exportOrders },
}, 'id');
```

`parseGridSchema(input: unknown)` 是不可信 JSON 进入运行时前的边界：它校验协议版本、普通对象、JSON-safe 数据、唯一 id、引用完整性与字段/列/动作限制。`bindGridSchema` 也会再次调用它，但在 API adapter 边界显式解析能更早返回协议错误。服务端不能下发或注入函数；`runtime` 中的 renderer、loader 和 handler 只能来自受信任的应用代码。

不可信的静态选项、facet 或自定义 options adapter 应通过 `normalizeGridOptions(input)`：它要求数组、普通选项对象、非空 label、唯一的 string/number/boolean value，并校验 color、disabled 和 meta 的形状。不要用类型断言绕过这两个运行时边界。

缺失 renderer、editor、loader、header 或 action handler 时会在绑定阶段立即抛错。
