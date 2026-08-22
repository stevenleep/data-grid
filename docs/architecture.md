# 架构与设计原则

## 三层结构

```text
业务定义 / JSON Schema / 数据接口
                 │
       @huiyun/data-grid/core
   查询、状态机、数据源、动作、编辑、视图
                 │
       @huiyun/data-grid/react
      生命周期、Provider、Selector 订阅
                 │
       @huiyun/data-grid/antd
   Ant Design 6 表格、工具栏、面板和单元格
```

### Core

纯 TypeScript，不依赖 React、Ant Design、DOM 或 CSS。它负责：

- 解析字段和列定义。
- 维护 query、columns、selection、data、views、editing、actions 七个状态域。
- 编译稳定的服务端请求协议。
- 调度数据源、请求取消、latest-wins、缓存和页码修正。
- 统一动作并发、错误、刷新和编辑事务。

### React

负责实例生命周期和细粒度订阅。`useGridSelector` 只在 selector 结果变化时更新组件，业务不需要为整个表格状态建立 Context 大对象。

### AntD

提供官方默认配方和可独立使用的 UI 原子。渲染层通过公开的 `GridInstance` 工作，不把 AntD 类型泄漏进 Core。

## 核心设计原则

1. 服务端分页优先。大量数据留在后端，浏览器处理当前页和 UI 状态。
2. 字段语义与展示列分离。字段负责数据、查询和编辑，列负责布局。
3. 能力必须声明。后端不支持的筛选、排序或全选能力不会被 UI 假装支持。
4. 协议先于组件。查询、动作和持久化都有稳定结构，UI 只是消费者。
5. 默认完整但允许拆解。普通页面一行 `DataGrid`，特殊页面重组公共原子。
6. 异步行为集中管理。请求、动作、编辑都由实例处理取消、并发和错误。

## 有意不包含的能力

- Canvas 渲染和百万行前端数据模式。
- Excel 级区域选择、公式引擎和透视表。
- 实时多人协同。
- 把任意后端协议硬编码进组件。

如果需要不同渲染器，可复用 Core 与 React 层实现独立 renderer，不必改变查询和业务协议。

## 实例稳定性

`useGrid` 以 `definition.id + revision` 确定实例身份。父组件重渲染时实例保持稳定，并通过 `updateOptions` 接收最新 source、回调和受控状态。不要每次渲染生成随机 `id` 或 `revision`。
