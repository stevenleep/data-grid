# 查询与传输协议

Data Grid 同时维护 UI Query 与 Request Query。前者适合编辑和追踪节点，后者适合网络传输和缓存签名。

## UI Query

```ts
interface GridQuery {
  pagination: GridPagination;
  keyword: string;
  filters: GridFilterGroup;
  sorts: GridSort[];
  projection?: string[];
  context?: Record<string, GridJsonValue>;
}
```

筛选树中的 group 和 condition 带临时 `id`，用于移动、删除和局部更新。这些 id 不会发送给后端。

## 编译后的请求

```json
{
  "pagination": { "type": "offset", "page": 1, "pageSize": 20 },
  "keyword": "星云",
  "filter": {
    "logic": "and",
    "children": [
      { "field": "status", "operator": "in", "value": ["pending"] },
      {
        "logic": "or",
        "children": [
          { "field": "amount", "operator": "greaterThan", "value": 10000 },
          { "field": "risk", "operator": "equals", "value": "high" }
        ]
      }
    ]
  },
  "sort": [{ "field": "created_at", "direction": "desc", "nulls": "last" }],
  "select": ["id", "order_no", "customer", "amount", "status"]
}
```

使用 `instance.query.compile()` 可随时获得当前请求。

## 字段映射

```ts
transport: {
  filterKey: 'customer_id',
  sortKey: 'customer_name',
  selectKey: 'customer',
  selectDependencies: ['customer_profile'],
  encodeFilter: (value, operator) => normalizeFilter(value, operator),
  encodeValue: (value) => value.id,
}
```

业务不应在每个页面手动遍历查询改字段名；映射属于字段协议。`selectDependencies`
使用后端原始 select key，适合声明计算字段、renderer 或权限判断所需的额外数据。

## Offset 分页

```json
{ "type": "offset", "page": 2, "pageSize": 50 }
```

查询条件或 pageSize 变化会回到第一页。删除最后一页数据后，实例会纠正超出范围的页码。

## Cursor 分页

```json
{
  "type": "cursor",
  "cursor": "opaque-token",
  "direction": "forward",
  "pageSize": 50
}
```

服务端通过 `pageInfo.nextCursor`、`previousCursor`、`hasNext` 和 `hasPrevious` 返回导航信息。cursor 必须被当作不透明字符串。返回 cursor 时可以省略对应的 `hasNext` / `hasPrevious`，Core 会推断为 `true`；声明为 `true` 时必须同时返回非空 cursor，矛盾的 pageInfo 会作为协议错误处理。

## 搜索

Remote 模式直接发送 `keyword`。Local 模式调用各字段的 `searchText`；未声明时使用值类型默认文本转换。

## 筛选

筛选支持：

- `and` / `or` 逻辑。
- group 级 `negated`。
- 嵌套深度和条件数限制。
- 文本、比较、范围、集合、日期相对值、布尔和空值操作符。

后端应按能力声明支持操作符，并对未知字段或操作符返回明确错误。

Core 会在执行或发送前规范化筛选树：删除空嵌套组，并按操作符校验值形状。`between` / `notBetween` 必须恰好有两个非空值；集合操作符必须使用非空数组；空值、布尔和相对日期操作符不能携带值。`context` 和筛选值必须是有限数值组成的 JSON-safe 数据，`NaN`、`Infinity`、循环引用和 class 实例会被拒绝。

### 自定义操作符的值协议

自定义操作符必须声明它接收的值形状，避免 Core、筛选面板和后端对同一操作符产生不同理解：

```ts
valueTypes: {
  code: {
    operators: ['isAssigned', 'oneOfCodes', 'codeRange'],
    operatorValueKinds: {
      isAssigned: 'none',
      oneOfCodes: 'multiple',
      codeRange: 'range',
    },
  },
},
fields: [{
  id: 'code',
  title: 'Code',
  valueType: 'code',
  filter: true,
}]
```

`none` 不接收值，`single` 接收一个 JSON 值，`multiple` 接收非空数组，`range` 接收恰好两个非空值。字段可通过 `filter.operatorValueKinds` 覆盖值类型声明；优先级为字段、值类型、内置操作符规则，未知操作符默认使用 `single`。解析后的声明位于 `resolvedField.filter.operatorValueKinds`，自定义 `filterEditor` 也会收到 `valueKind`。

## 排序

排序是有序数组，多字段排序顺序即优先级。`nulls` 只在 `capabilities.sort.nulls` 为 true 时出现。

## 投影与请求签名

启用 `projection` 后，可见列变化会更新 `select` 并触发请求。Core 总会把行标识、字段依赖和全局必需字段合并进投影，避免后端严格执行 `select` 后返回无法渲染或无法定位的行：

```ts
const definition = defineGrid<Order>({
  id: 'orders',
  rowKey: (row) => `${row.tenantId}:${row.id}`,
  rowKeyIdentity: 'tenant-order-v1',
  projection: {
    // 后端原始 select key；function rowKey 和未映射的 path rowKey 必须显式声明。
    rowKey: ['tenant_id', 'id'],
    // 语义 field id，会自动转换为各字段的 transport.selectKey。
    requiredFields: ['permission'],
    // 不对应语义字段的后端原始 select key。
    requiredKeys: ['row_version'],
  },
  fields,
});
```

字符串 `rowKey` 会自动使用同名字段的 `selectKey`，没有同名字段时直接使用该字符串；path `rowKey` 只有在能匹配一个字段 path 时才会自动映射。显式设置 `query.projection = []` 表示只请求这些必需 key，而不是退回全部可见列。

函数形式的 `rowKey` 如果会随 React render 重建，应提供稳定的 `rowKeyIdentity`。Core 用这个语义身份判断定义是否真的切换，不能使用函数对象地址代替业务身份；改变取 key 的规则时同时改变 identity。

请求签名基于稳定序列化结果，不包含 UI 临时 id；它用于缓存、去重和 all-matching 选择范围。
