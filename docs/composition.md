# 自由组合

`DataGrid` 默认配方用于大多数后台页面。传入 children 后可以完全接管布局，同时复用同一个实例。

## 官方配方

```tsx
<DataGrid
  definition={definition}
  source={source}
  toolbar={{ views: true, filters: true, sorts: true, search: true }}
  footer={{ selection: true, summary: true, total: true, pagination: true }}
  beforeTable={<BusinessNotice />}
  afterTable={<AuditHint />}
/>
```

`toolbar={false}` 或 `footer={false}` 可关闭对应区域。

五个稳定区域还可通过 slots 替换或包裹。直接传节点表示替换；函数会收到默认内容与实例，可在不复制官方配方的情况下前后插入业务 UI：

```tsx
<DataGrid
  definition={definition}
  source={source}
  slots={{
    toolbar: (defaults, grid) => (
      <>
        <BusinessScope dataset={grid.definition.id} />
        {defaults}
      </>
    ),
    status: <BusinessStatus />,
    footer: (defaults) => <StickyFooter>{defaults}</StickyFooter>,
  }}
/>
```

## 只渲染已有实例

`DataGridView` 把实例生命周期与官方 AntD 配方分开。它不会调用 `start`、`stop`、`updateOptions` 或 `destroy`；这些必须由实例所有者负责。通过 `useGrid` 创建时，Hook 已负责启动、更新和停止：

```tsx
function OrdersGrid() {
  const grid = useGrid({ definition, source, persistence });
  return <DataGridView grid={grid} slots={{ table: wrapBusinessTable }} />;
}
```

如果通过 Core 的 `createGrid` 创建，则由业务显式管理 `await grid.start()` 和最终 `grid.destroy()`。同一个实例可以交给不同 renderer，但不要同时挂载两个会竞争同一交互状态的可编辑视图。

## 重组公共组件

```tsx
<DataGrid definition={definition} source={source}>
  {(instance) => (
    <GridShell aria-label="订单工作台">
      <BusinessHeader total={instance.getState().data.total} />
      <GridToolbar
        start={
          <>
            <GridViewTrigger<Order> />
            <GridColumnTrigger<Order> />
            <GridFilterTrigger<Order> />
            <GridSortTrigger<Order> />
            <GridSearch<Order> width={280} />
          </>
        }
        end={
          <>
            <GridActions<Order> placement="toolbar" />
            <GridRefresh<Order> />
          </>
        }
      />
      <GridActiveFilters<Order> />
      <GridStatus<Order> />
      <GridTable<Order> rowActions={{ maxVisible: 2, width: 172 }} />
      <GridFooter
        start={
          <>
            <GridSelectionSummary<Order> />
            <GridSummary<Order> />
            <GridTotal<Order> />
          </>
        }
        end={<GridPagination<Order> />}
      />
    </GridShell>
  )}
</DataGrid>
```

## 在业务 Drawer 中放构造器

`GridFilterBuilder`、`GridSortBuilder` 和 `GridColumnPanel` 可脱离默认 Popover 使用。

```tsx
function FilterDrawer() {
  const instance = useGridInstance<Order>();
  const filters = useGridSelector<Order, GridFilterGroup>((state) => state.query.filters);
  return (
    <Drawer open={open} onClose={close}>
      <GridFilterBuilder
        value={filters}
        onChange={(value) => instance.query.setFilters(value, 'user')}
      />
    </Drawer>
  );
}
```

## 直接使用 Core + Provider

```tsx
const instance = useGrid({ definition, source });

<GridProvider value={instance}>
  <GridUiProvider value={{ language: 'zh-CN', pageSizeOptions: [20, 50] }}>
    <MyRenderer />
  </GridUiProvider>
</GridProvider>;
```

这适合建立公司内部设计系统 renderer，或在同一 Core 上接非 AntD 表格。

## UI 配置边界

适合放在 definition：字段语义、列结构、动作、编辑策略和稳定业务元数据。

适合放在 DataGrid props：语言、时区、主题、分页尺寸、行/值事件、页面级空态和表格平台属性。

适合放在业务组件：Modal、Drawer、路由跳转、表单、权限服务和具体 API 调用。

## 组合契约

- 独立使用 `GridActionButton` 时，按钮会订阅 query、selection 和当前 rows，`visible` / `disabled` 与默认 `GridActions` 保持一致。
- `GridTable.selection` 由 Grid 持有选中 key；业务可以提供其他 AntD rowSelection 外观配置，并通过 `onSelect` / `onSelectAll` 观察事件，但不能从两个地方同时控制 selected keys。
- 临时传给 `GridTable.columns`、但未注册在 definition 的展示列可以渲染；它们不会写入实例列状态。需要显隐、固定、拖动、宽度持久化或投影时，应把列注册进 definition，或给受控 `GridColumnPanel` 提供完整 column state。
- 临时/业务列读取了 projection 之外的数据时，通过 `GridTable.requiredFields` 声明 definition 中的语义 field id；组件会在挂载期间把它们加入请求并在卸载时清理，Core 再按字段 `transport.selectKey/selectDependencies` 编译为传输 key。没有对应语义字段的原始 key 应声明在 `definition.projection.requiredKeys`。自定义 renderer 不使用 `GridTable` 时，可直接调用 `instance.projection.register(fieldIds)` 并执行返回的 cleanup；`getRequiredFields()` 可用于诊断当前合并结果。
- 当 `GridFilterPanel` 只管理字段子集时，给并列的 `GridActiveFilters.fields` 传入同一字段集合。子集外条件会显示为只读，单项关闭和“清除”都只修改允许管理的条件，不会绕过租户、权限或页面固定筛选。
- 行、可点击单元格和可编辑单元格支持 Enter / Space。自带链接、按钮、输入框等交互后代不会重复触发行或值点击。
