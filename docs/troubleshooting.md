# 故障排查

## 表格不重新请求

检查：

1. source 是否真的是新数据语义；Remote source 身份变化会刷新。
2. 受控 `state.query` 是否在 `onStateChange` 后写回。
3. Controlled source 是否在 `onQueryChange` 中触发外部查询。
4. 动态 Controlled 的新结果是否携带产生它的 `resultRequestSignature`；错误是否使用匹配请求/数据集的 `{ value, requestSignature, datasetKey? }` envelope。首次握手后，克隆旧结果不会被当作新结果接收。
5. 是否错误地在外层缓存了旧 request。

Remote source 未设置 `datasetKey` 时，`read` 函数引用变化会被视为数据集切换；如果 source 在 render 内创建，请稳定 reader 引用或显式设置数据集键。

若切换租户后筛选或视图被清空，这是默认的数据边界保护。只为确认与租户无关的域配置 `datasetTransition`；若 query/views 由业务受控，则应把新 slice 与新的 `stateDatasetKey` 原子写回。

需要强制刷新时调用 `instance.data.reload()`；需要清除当前请求缓存再刷新时调用 `instance.data.invalidate()`。

## 筛选 UI 可选但后端不支持

缩小 `capabilities.filter`，或在字段 `filter` 中限制 operators。能力声明不能比后端真实实现更宽。

## 关系字段 Local 筛选无效

内置 `select`、`multiSelect`、`status`、`user` 和 `relation` 会按 primitive，或对象的 `id` / `value` / `key` 比较。若业务实体使用其他身份字段，为字段提供 `getIdentity` / `equals`；只有需要完全自定义运算符语义时才使用 `filterPredicate`。Remote source 仍由后端解释筛选协议。

## 排序字段不对

检查字段 `transport.sortKey`。不要在每个页面请求前手工映射字段名。

## 点击行时操作按钮也打开详情

使用 Grid 自带 `GridActions` 和 `rowActions`；其事件会停止冒泡。自定义按钮需要自行 `event.stopPropagation()`。值点击如果不希望继续触发行点击，也应停止冒泡。

## 编辑后值回退

- `editing.save` 返回更新后的 row，或返回 `{ type: 'grid-edit-result', row, reload }`。
- 如果返回空值且 `reloadOnSave` 未关闭，实例会刷新服务端数据。
- 检查接口返回是否仍是旧值。
- 乐观保存失败会有意回滚。

## 选择跨页后只拿到当前页 rows

`selectedRows` 只保证已经加载并见过的行；跨页批量接口应使用 `selection` + `request` 表达范围，而不是要求浏览器拥有所有 row。

## 持久化没有恢复

- `definition.id`、`revision` 和 persistence scope 必须匹配。
- revision 变化后需要实现 `migrate`。
- 检查存储是否在 SSR 环境访问。
- Local persistence 仅在浏览器可用。

## React StrictMode 请求两次

组件已处理 effect replay，不应重复初始 read。若仍重复，检查业务是否同时在 source 外层发起了请求，或是否每次渲染改变 `definition.id/revision`。

## 样式缺失

确保应用入口导入：

```ts
import '@stevenleep/data-grid/style.css';
```

## 安装后报缺少 React 或 AntD

UI 依赖被有意声明为 optional peers，使用根入口或 `/antd` 时需要由应用显式安装：

```bash
pnpm add react react-dom antd @ant-design/icons
```

使用 `/react` 至少安装 React 与 React DOM。只有 `/core` 完全不需要这些 UI peers。

## 子路径类型无法解析

`@stevenleep/data-grid/core`、`/react` 和 `/antd` 使用现代 `exports`。TypeScript 应配置 `moduleResolution: "Bundler"`、`"Node16"` 或 `"NodeNext"`；旧的 `"node"` 不在支持范围内。不要只添加路径别名掩盖运行时同样无法解析的问题。

## Core-only 项目需要 DOM lib

Core 的本地持久化使用最小 `GridStorageLike`，不要求 DOM `Storage`。取消仍采用标准 `AbortSignal`：Node 服务项目应安装匹配运行时的 `@types/node`，浏览器/Worker 项目由 `DOM` 或 `WebWorker` lib 提供。CI 会在 TypeScript 5.4、`skipLibCheck: false`、仅 `ES2022` lib 加 Node typings 的配置验证；如果仍出现 `Storage`、`Window` 等 DOM 全局，先确认导入的是 `@stevenleep/data-grid/core` 且没有把根入口或 `/react` 带入服务端文件，然后用真实 tarball 复现并报告声明路径。

## Next.js 提示 hooks 只能在 Client Component 使用

根入口、`/react` 和 `/antd` 的发布产物带 `"use client"`；`/core` 不带。业务页面同时使用自身 hooks、路由或浏览器 API 时，仍应在最外层业务组件声明 `"use client"`，并从 Server Component 只传可序列化 props。不要从未公开的 `dist` chunk 或 `src` 深层路径导入，否则会绕开该边界。

## 日期、时区或列宽交互在旧浏览器异常

支持基线是 ES2020、`AbortController`、`ResizeObserver`、Pointer Events 和提供 IANA 时区数据的现代 `Intl`。受控企业浏览器或精简 ICU 运行时应在应用入口补齐相应 polyfill/时区数据，并用自身支持矩阵验证。仓库 Chromium smoke 证明当前 evergreen Chromium 路径，不代表所有旧版浏览器。

## AntD 上下文告警

`DataGrid` 内部通过一个 `display: contents` 包装元素提供 AntD App 上下文，不会新增可见布局盒。业务仍可在应用根部使用自己的 `ConfigProvider` 与 `App`，主题和 locale 会正常继承。

## React 18 下出现 AntD/rc-component 的 `.d.ts` 错误

AntD 6 公开声明支持 React 18，但其当前声明及部分 rc-component 声明会在 `skipLibCheck: false` 下产生库内部冲突（例如 React 19 才有的 `ActionDispatch`）。Vite 等应用通常将 `skipLibCheck` 设为 `true`；这仍会检查业务代码与 Data Grid API。若组织策略强制检查所有依赖声明，请在升级前用项目锁定的 React/AntD/TypeScript 组合验证，并跟进上游修复；Core-only 消费验证不需要该绕过。

## 发布前检查

```bash
pnpm release:check
```

检查范围包括格式、类型、测试与覆盖率、ESM/CJS/声明构建、四入口 API report、Demo 构建与 gzip 预算、导出映射、pnpm/npm tarball 安装、无 DOM/UI peers 的 Core、React 18/19 客户端与 hydration，以及 packed Vite 的 Chromium 执行。完整流程见[维护与发布](./releasing.md)。
