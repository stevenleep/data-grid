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

解析后的 `field.capabilities` 会把字段级能力统一成四个布尔值：`search`、`filter`、`sort`、`edit`。它们表示字段协议允许什么，不会越权替业务作决定：数据源的 `GridCapabilities` 还会限制后端真正支持什么，renderer 也必须有相应 editor 才能提供快捷编辑。`search: false` 可让敏感字段或不适合文本化的字段退出 Local keyword 搜索。

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

Core 内置值类型提供默认列、操作符、codec、空值判断和比较等语义；AntD 为这些类型提供默认展示，但只有 `supportsGridDefaultEditor` 返回 true 的类型拥有默认编辑器。通过 `definition.valueTypes` 可注册自定义类型。

`date` 与 `dateTime` 是两种不同协议。它们都接受有效的 `Date`、Unix 毫秒时间戳、`YYYY-MM-DD` 和 ISO `T` 日期时间；带 `Z` / `±HH:mm` 的值按偏移解析，没有偏移的 ISO 日期时间明确按 UTC 解析，其他地区格式（例如 `08/25/2026`）不会被猜测。数值始终是**毫秒**，不是秒。

- `date` 表示日历日期：`YYYY-MM-DD` 本身不带时区；`Date`、时间戳和日期时间会先投影到 Local query 的 `temporal.timeZone`（默认 UTC），再按年月日筛选和排序。
- `dateTime` 表示绝对时刻：所有表示会归一到同一个 instant 后比较；日期字符串等于该日 UTC 零点。
- 无效日期不参与 Local 范围匹配；普通 `number` / `decimal` 字段不会因为值看起来像时间戳或 ISO 字符串而获得日期语义。

直接调用 resolved field 的默认 `equals` / `compare` 时没有 query 上下文，因此 `date` 使用 UTC；`applyLocalGridQuery(..., temporal)` 会使用指定时区。字段显式声明的 `equals` / `compare` 仍优先于内置规则。Remote / Controlled 数据源应在后端实现同样的协议，或通过 adapter 与 `transport.encodeFilter` 转换成后端约定。

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

关系字段可以显式描述目标资源与基数，但这些信息只是协议元数据，不会让 Core 自行请求另一张表：

```ts
field.property('customer', {
  title: '客户',
  relation: {
    target: 'crm.customer',
    cardinality: 'one',
    keyField: 'id',
    labelField: 'name',
  },
  filter: true,
  edit: true,
});
```

省略 `valueType` 时，带 `relation` 的字段自动使用 `relation`。`cardinality: 'one'` 默认使用单值操作符和 editor，`many` 默认使用集合操作符并令 `edit.multiple` 为 true；字段级配置仍可覆盖默认值。

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

## 公式、Lookup 与 Rollup

`derivation` 描述值的来源与依赖，不是可执行脚本语言，也不会触发跨资源查询。最终输出仍使用普通 `valueType`，因此公式结果可以是 money、date、status 或任意自定义类型：

```ts
field.accessor('total', (row) => row.subtotal + row.tax, {
  title: '含税金额',
  valueType: 'money',
  derivation: {
    kind: 'formula',
    dependencies: ['subtotal', 'tax'],
    expression: 'subtotal + tax', // 仅作可移植描述，Core 不解析
    binding: 'runtime',
  },
});

field.property('customerRegion', {
  title: '客户区域',
  derivation: {
    kind: 'lookup',
    relationField: 'customer',
    targetField: 'region',
    binding: 'source',
  },
});
```

- `binding: 'source'` 表示 API 已物化结果；投影只请求派生字段自己的 `selectKey`。
- `binding: 'runtime'` 表示受信任的 `accessor` 物化结果；必须提供 accessor，投影请求依赖字段而不会假设后端存在派生输出 key。
- `lookup` / `rollup` 的 `relationField` 必须引用本 definition 中的 relation 字段。
- 未知依赖、自依赖和依赖环会在 definition/schema 绑定阶段失败。

如 runtime accessor 还需要不对应语义字段的原始数据，可在该派生字段上声明 `transport.selectDependencies`。

## AntD 展示与编辑扩展

字段级 `render` / `editor` 适合单个字段；同一 valueType 在整个页面复用时，用 `DataGrid` / `DataGridView` 的组件注册表：

```tsx
<DataGrid<Order>
  definition={definition}
  source={source}
  cellRenderers={{ attachment: AttachmentCell }}
  cellEditors={{ attachment: AttachmentEditor, file: FileEditor }}
/>
```

renderer 的查找顺序是字段 `render` → `cellRenderers[valueType]` → 内置展示；editor 的顺序是字段 `editor` → `cellEditors[edit.editor ?? valueType]` → AntD 默认 editor。注册值是 React 组件，因此可以正常使用 Hooks。

AntD 默认 editor 支持 `text`、`longText`、数值、布尔、选项、日期、时长、链接、邮箱、电话、user/relation 与 JSON。`image`、`file` 和未知自定义类型默认只展示；必须显式提供 editor，或用 `edit.editor` 映射到受支持的默认 editor。可用 `supportsGridDefaultEditor(type)` 在平台封装层做能力检查。`edit: true` 表示业务允许编辑，不等于任意 renderer 都能猜出正确输入控件。

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
