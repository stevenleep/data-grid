# API 索引

本页是公共 API 导航，不替代 TypeScript 声明。IDE 中的泛型和参数类型是消费依据；维护者提交的 `etc/api/*.api.md` 是四个入口的完整 SemVer 审查基线，由 `pnpm api:check` 从实际构建产物校验。

## 包入口

| 入口                          | 内容                         |
| ----------------------------- | ---------------------------- |
| `@huiyun/data-grid`           | 全部常用 API                 |
| `@huiyun/data-grid/core`      | 纯 TypeScript 核心           |
| `@huiyun/data-grid/react`     | React Provider、Hooks 和订阅 |
| `@huiyun/data-grid/antd`      | Ant Design 6 组件和类型      |
| `@huiyun/data-grid/style.css` | 默认样式                     |

根入口、`/react` 和 `/antd` 是 React Client Component 入口；`/core` 是不带 `"use client"` 的 server-safe 入口。只有上述 exports 和对应 API reports 中的符号属于公共契约，其他源码路径不允许深层导入。

## 定义

- `defineGrid`
- `defineGridFields`
- `createFieldHelper`
- `defineGridValueType`
- `resolveGridDefinition`
- `defineGridSchema`
- `defineGridRuntime`
- `bindGridSchema`
- `parseGridSchema`（不可信 `unknown` 的协议边界）
- `builtinValueTypes`

核心类型：`GridDefinition`、`GridProjectionDefinition`、`GridFieldDefinition`、`GridColumnDefinition`、`GridValueTypeDefinition`、`GridAnyValueTypeDefinition`、`GridValueTypeRegistry`、`GridSchema`、`GridRuntime`。

字段和自定义值类型的业务 callback 应分别通过 `createFieldHelper<Row>()` 与 `defineGridValueType<Row, Value>()` 建立精确类型。`GridAnyValueTypeDefinition` 中的 `any` 只用于框架内部保存不同 Value 的 registry 边界，不是建议业务 callback 使用的公共建模方式。

## 数据源

- `createLocalSource`
- `createRemoteSource`
- `createControlledSource`
- `resolveGridCapabilities`
- `normalizeGridResult`
- `normalizeGridOptions`（不可信选项/facet 的协议边界）

核心类型：`GridDataSource`、`GridReadInput`、`GridReadResult`、`GridCapabilities`、`GridTotalValue`、`GridPageInfo`。根入口用 `GridTotalValue` 避免与同名 UI 组件冲突；`/core` 入口仍导出原名 `GridTotal`。

## 查询

- `compileGridQuery`
- `applyLocalGridQuery`
- `serializeGridQuery`
- `validateGridQuery`
- `mapGridQueryFields`
- `createFilterGroup`
- `createFilterCondition`
- `addFilterNode` / `updateFilterNode` / `removeFilterNode` / `moveFilterNode`
- `pruneFilterGroup` / `pruneEmptyFilterGroups`
- `getFilterOperatorValueKind`
- `getRequestSignature`

核心类型：`GridQuery`、`GridRequestQuery`、`GridFilterGroup`、`GridFilterCondition`、`GridFilterValueKind`、`GridFilterOperatorValueKinds`、`GridSort`、`GridPaginationState`。根入口使用 `GridPaginationState` 避免与分页 UI 组件冲突；`/core` 入口仍导出原名 `GridPagination`。

## 持久化

- `createLocalGridPersistence`
- `parseGridPersistedState`（不可信自定义/远端 preferences 的协议边界）

核心类型：`GridPersistence`、`GridPersistedState`、`GridView`、`GridStorageLike`、`LocalGridPersistenceOptions`。

## 实例

```ts
instance.query; // set / update / keyword / filters / sorts / page / compile
instance.columns; // visible / order / width / pinned / density / reset
instance.selection; // set / toggle / page / allMatching / clear
instance.data; // reload / invalidate / updateRow / patchRow
instance.views; // create / rename / duplicate / save / apply / remove
instance.editing; // canEdit / begin / draft / commit / cancel
instance.actions; // list / context / run / key
instance.options; // load(fieldId, search?, { signal? }) / clear
instance.projection; // register(fieldIds) / getRequiredFields
await instance.flushPersistence(); // flush debounced and queued preference writes
```

实例创建：`createGrid`、`useGrid`。访问：`useGridInstance`。订阅：`useGridSelector`、`useGridEvent`。

## 默认组件

- `DataGrid`
- `GridDefaultToolbar`
- `GridDefaultFooter`
- `GridShell`
- `GridToolbar`
- `GridTable`
- `GridFooter`

## 查询与设置组件

- `GridSearch`
- `GridFilterTrigger` / `GridFilterPanel` / `GridFilterBuilder`
- `GridSortTrigger` / `GridSortPanel` / `GridSortBuilder`
- `GridColumnTrigger` / `GridColumnPanel`
- `GridViewTrigger` / `GridViewPanel`
- `GridDensityMenu`
- `GridActiveFilters`（`fields` 可限制允许删除的筛选字段）

## 状态与页脚组件

- `GridStatus`
- `GridRefresh`
- `GridSummary`
- `GridSelectionSummary`
- `GridSelectionBar`
- `GridTotal`
- `GridPagination`

## 动作和单元格

- `GridActions`
- `GridActionButton`
- `GridCell`
- `GridEditableCell`
- `renderGridValue`
- `GridRenderErrorBoundary`（函数 fallback 的第二参数可重置 boundary）

交互类型：`GridRowClickContext`、`GridCellClickContext`、`GridRowInteractionContext`、`GridCellInteractionContext`、`GridRowActionsConfig`、`GridTableSelectionProps`。自定义组合可通过 `GridUiConfig.onRenderError` 统一接收 renderer/boundary 错误。

## DataGrid 常用 Props

| Prop                                    | 用途                                |
| --------------------------------------- | ----------------------------------- |
| `definition`                            | 字段、列、动作和编辑定义            |
| `source`                                | Local、Remote 或 Controlled 数据源  |
| `defaultState` / `state`                | 非受控初值或受控 slice              |
| `persistence`                           | 本地或服务端偏好协议                |
| `temporal`                              | Local 相对日期的时区、周起始与时钟  |
| `toolbar` / `footer`                    | 默认配方能力开关                    |
| `rowActions`                            | 行操作可见数量、宽度和标题          |
| `onRowClick` / `onCellClick`            | 语义交互回调                        |
| `isRowClickable` / `isCellClickable`    | 点击能力判断和视觉提示              |
| `tableProps`                            | 除核心受控项之外的 AntD Table props |
| `pageSizeOptions`                       | 可选分页尺寸                        |
| `renderEmpty` / `renderError`           | 空态和错误态                        |
| `onStateChange` / `onEvent` / `onError` | 状态、事件和错误回调                |

独立组合 `GridTable` 时可用其 `requiredFields` prop 声明临时/业务列额外需要的语义 field id；传输 key 仍由字段 transport 编译。它不是 `DataGrid` 顶层 prop。
