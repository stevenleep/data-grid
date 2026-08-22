# 故障排查

## 表格不重新请求

检查：

1. source 是否真的是新数据语义；Remote source 身份变化会刷新。
2. 受控 `state.query` 是否在 `onStateChange` 后写回。
3. Controlled source 是否在 `onQueryChange` 中触发外部查询。
4. 是否错误地在外层缓存了旧 request。

需要强制刷新时调用 `instance.data.reload()`；需要清除当前请求缓存再刷新时调用 `instance.data.invalidate()`。

## 筛选 UI 可选但后端不支持

缩小 `capabilities.filter`，或在字段 `filter` 中限制 operators。能力声明不能比后端真实实现更宽。

## 关系字段 Local 筛选无效

显示值通常是对象，筛选值通常是 id。为该字段提供 `filterPredicate`，按实体 id 比较。Remote source 不受此本地比较问题影响。

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
import '@huiyun/data-grid/style.css';
```

## 子路径类型无法解析

`@huiyun/data-grid/core`、`/react` 和 `/antd` 使用现代 `exports`。TypeScript 应配置 `moduleResolution: "Bundler"`、`"Node16"` 或 `"NodeNext"`；旧的 `"node"` 不在支持范围内。不要只添加路径别名掩盖运行时同样无法解析的问题。

## AntD 上下文告警

`DataGrid` 内部已经提供无额外 DOM 的 AntD App 上下文。业务仍可在应用根部使用自己的 `ConfigProvider` 与 `App`，主题和 locale 会正常继承。

## 发布前检查

```bash
pnpm release:check
```

检查范围包括格式、类型、测试与覆盖率、ESM/CJS/声明构建、Demo 构建、导出映射、npm tarball 内容和真实消费项目。完整流程见[维护与发布](./releasing.md)。
