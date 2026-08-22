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
  "select": ["order_no", "customer", "amount", "status"]
}
```

使用 `instance.query.compile()` 可随时获得当前请求。

## 字段映射

```ts
transport: {
  filterKey: 'customer_id',
  sortKey: 'customer_name',
  selectKey: 'customer',
  encodeFilter: (value, operator) => normalizeFilter(value, operator),
  encodeValue: (value) => value.id,
}
```

业务不应在每个页面手动遍历查询改字段名；映射属于字段协议。

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

服务端通过 `pageInfo.nextCursor`、`previousCursor`、`hasNext` 和 `hasPrevious` 返回导航信息。cursor 必须被当作不透明字符串。

## 搜索

Remote 模式直接发送 `keyword`。Local 模式调用各字段的 `searchText`；未声明时使用值类型默认文本转换。

## 筛选

筛选支持：

- `and` / `or` 逻辑。
- group 级 `negated`。
- 嵌套深度和条件数限制。
- 文本、比较、范围、集合、日期相对值、布尔和空值操作符。

后端应按能力声明支持操作符，并对未知字段或操作符返回明确错误。

## 排序

排序是有序数组，多字段排序顺序即优先级。`nulls` 只在 `capabilities.sort.nulls` 为 true 时出现。

## 投影与请求签名

启用 `projection` 后，可见列变化会更新 `select` 并触发请求。请求签名基于稳定序列化结果，不包含 UI 临时 id；它用于缓存、去重和 all-matching 选择范围。
