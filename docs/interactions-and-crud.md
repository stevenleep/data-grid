# CRUD 与交互

Data Grid 负责列表状态和动作协议；新增/详情表单通常由业务自己的 Modal、Drawer 或页面实现。

## 新增

```tsx
actions: [
  {
    id: 'create',
    label: '新建订单',
    placement: 'toolbar',
    intent: 'primary',
    run: () => setEditor({ mode: 'create' }),
  },
];
```

保存成功后可以更新业务数据源，Remote source 身份变化会触发重新读取；也可以调用 `instance.data.reload()`。

## 查看、编辑、复制和删除

```tsx
actions: [
  {
    id: 'view',
    label: '查看',
    placement: 'row',
    run: ({ row }) => openDetail(row!),
  },
  {
    id: 'edit',
    label: '编辑',
    placement: 'row',
    run: ({ row }) => openEditor(row!),
  },
  {
    id: 'duplicate',
    label: '复制',
    placement: 'row',
    run: ({ row, signal }) => duplicateOrder(row!.id, signal),
  },
  {
    id: 'delete',
    label: '删除',
    placement: 'row',
    intent: 'danger',
    getConfirmation: ({ row }) => `确认删除 ${row?.orderNo}？`,
    run: ({ row, signal }) => deleteOrder(row!.id, signal),
  },
];
```

动作自动获得 pending 状态、同 key 并发保护、错误记录、`AbortSignal` 和可选刷新。

## 行点击和值点击

```tsx
<DataGrid<Order>
  definition={definition}
  source={source}
  onRowClick={({ row, rowIndex, instance, event }) => openDetail(row)}
  isCellClickable={({ field }) => ['orderNo', 'customer'].includes(field?.id ?? '')}
  onCellClick={({ row, field, value, event }) => {
    event.stopPropagation();
    openValue({ row, field, value });
  }}
/>
```

`onCellClick` 提供已解析 field、column 和 value，业务不需要反查列定义。按钮、链接、输入框、复选框和 Grid 行操作不会误触发行点击。

## 行快捷操作布局

```tsx
<DataGrid rowActions={{ maxVisible: 2, width: 172 }} />
```

超出 `maxVisible` 的动作进入“更多”菜单；动作仍按 `order` 排序并执行相同权限、确认和 pending 逻辑。

## 批量操作

```tsx
{
  id: 'bulkDelete',
  label: '批量删除',
  placement: 'bulk',
  intent: 'danger',
  getConfirmation: ({ selection }) => `确认删除 ${selectionCount(selection)} 条记录？`,
  run: async ({ selection, request, signal, instance }) => {
    await api.orders.bulkDelete({ selection, request }, signal);
    instance.selection.clear();
    await instance.data.reload();
  },
}
```

显式选择保存 key；all-matching 保存当前查询签名、总数和排除 key，不会把所有 id 拉到浏览器。

## 单元格快捷编辑

```tsx
fields: [
  {
    id: 'status',
    title: '状态',
    valueType: 'status',
    options: statusOptions,
    edit: { enabled: true, required: true },
  },
],
editing: {
  optimistic: true,
  apply: (row, field, value) => ({ ...row, [field.id]: value }),
  save: async ({ rowKey, field, value, signal }) => {
    return api.orders.patch(rowKey, { [field.id]: value }, signal);
  },
}
```

双击可编辑单元格或聚焦后按 Enter 开始编辑。失败、取消或卸载时乐观值会回滚。

## 权限与可见性

```ts
visible: ({ row }) => permissions.canView(row),
disabled: ({ row }) => row?.locked || !permissions.canEdit(row),
```

`visible` 与 `disabled` 在列表和真正执行动作时都会再次判断，避免只靠 UI 隐藏。
