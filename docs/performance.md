# 性能与生产建议

## 使用服务端分页

组件的优化目标是后台列表交互，而不是在浏览器持有百万行。数据量增长时，把搜索、筛选、排序、汇总和分页交给后端。

推荐默认值：

- 每页 20–100 行。
- `keepPreviousData: true`。
- 短时间重复查询设置 2–10 秒 `staleTime`。
- 对高频返回查询设置合理 `cacheTime` 与 `maxCacheEntries`。

## 保持身份稳定

```tsx
const definition = useMemo(() => defineGrid(...), []);
const source = useMemo(() => createRemoteSource(...), [tenantId]);
```

- `definition.id` 和 `revision` 必须稳定。
- `rowKey` 必须唯一且跨请求稳定。
- `datasetKey` 表示租户/项目/资源边界；`driverKey` 表示 endpoint 或 adapter 语义版本，不要混用。
- 有稳定 `datasetKey` 时可安全更新 reader closure；传输语义真正变化时提升 `driverKey` 以取消旧请求并隔离缓存。
- Controlled adapter 的缓存 key 必须包含 `datasetKey`，并把结果/数据集敏感受控状态各自的 `resultDatasetKey` / `stateDatasetKey` 原样回传；不要用对象引用承担来源判断。
- 事件和 render 回调在必要时使用 `useCallback`。

实例会接受最新 options。运行时 callback 可以热更新；如果当前编译请求因此变化，Remote/Controlled 会重新请求或发出新协议，Local 搜索/筛选/排序 callback 变化会重新执行当前查询。

## 请求效率

- debounce 搜索输入，默认搜索组件已处理。
- 使用 projection 只请求可见字段，但前提是后端真的能获益；通过 definition projection 和 `selectDependencies` 声明 rowKey、计算、权限及 renderer 所需数据。
- Projection 只优化传输，不削弱 `GridReadResult<Row>` 契约；稀疏接口响应应在 source adapter 中物化为声明的 Row，不能用类型断言伪装成完整实体。
- facets 和 summary 只在接口支持时开启。
- 使用 `AbortSignal` 取消 fetch、下载、选项加载和动作请求。
- 不要在 `read` 内忽略 request，之后又用全量接口在前端二次过滤。

## 渲染效率

- Core 实例稳定，React 使用 selector 订阅。
- 单元格默认提供 `shouldCellUpdate`，按字段 equals 判断是否变化。
- 不要在 cell renderer 中创建昂贵图表或发请求；预取数据并用轻量组件展示。
- 复杂实体选项使用异步 loader 和缓存。
- 只有确实需要时启用大量固定列，固定区域过宽会压缩中间滚动区。

## 动作和编辑

- 动作用 `signal` 取消无效请求。
- 更新当前行可返回新 row，避免无必要的整页刷新。
- 需要服务端重新计算汇总或权限时使用 `refresh: true` 或显式 `data.reload()`。
- 乐观编辑只用于可可靠回滚的字段。

## 包体积

Ant Design、React、React DOM 和图标是 optional peer dependencies，不会打入 npm 库产物。按层级导入可以让非 UI 环境只消费 Core，且不安装上述 UI peers：

```ts
import { createGrid, compileGridQuery } from '@huiyun/data-grid/core';
```

使用根入口或 `/antd` 时，应用 bundle 仍会包含它真正使用的 UI 运行时；peer 只避免重复打包，不会让 UI 代码消失。仓库 Demo 为单页完整演示，会包含 AntD 运行时代码，因此它的构建体积不代表 npm 库产物体积。

`pnpm demo:build` 会校验 Demo 已拆分为多个 chunk，并对单 chunk 和全部 JavaScript 的 gzip 大小执行预算，防止无意的依赖或全量导入回归。
