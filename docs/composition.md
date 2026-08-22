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
