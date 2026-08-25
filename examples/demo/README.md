# @huiyun/data-grid Demo

这是 `@huiyun/data-grid` 的完整交互站点，不是静态组件陈列。它用一个订单后台说明业务接入方式，并用独立实验室验证不同数据源和运行状态。

## 运行

从仓库根目录执行：

```bash
pnpm install
pnpm demo
```

生产构建：

```bash
pnpm demo:build
```

默认地址为 `http://localhost:5173`。Vercel 部署时将 Root Directory 设置为 `examples/demo`，并确认已开启 **Include source files outside of the Root Directory**，因为构建会读取仓库根目录的 workspace 包和脚本。

## 四个演示分区

### 完整业务工作台

真实可执行的订单管理列表，覆盖：

- 新增、详情、表单编辑、删除和复制；
- 单击行、点击订单号或客户值、双击状态快捷编辑；
- 搜索、嵌套筛选、多字段排序、字段显隐/顺序/宽度和密度；
- offset 分页、当前页选择、All Matching 跨页选择和批量动作；
- 命名视图、本地偏好、页级汇总、精确总数和真实 CSV 下载；
- 编译后的服务端请求与最近用户事件观测。

“恢复出厂”会同时恢复 137 条初始订单，清空查询、选择、视图和字段偏好。

### 数据源与状态

同一份字段定义在三种数据所有权之间切换：

- `Remote API`：服务端分页，展示正常、慢请求、空响应、错误和恢复；
- `Local rows`：查询在浏览器内执行，适合小型配置数据；
- `Controlled store`：结果、query 与选择状态由业务 Store 持有，Grid 只发出变更意图；示例始终把真实 request signature、`resultDatasetKey` 与 `stateDatasetKey` 随外部 envelope 回传，切换 query 或 dataset 时旧结果、旧结果的克隆和旧实体状态都不会被当作当前 payload，适用于 React Query、SWR 或 Alova adapter。

右侧面板显示当前传输协议、最近事件以及 Remote 请求或 Controlled 查询通知次数。

### 自由组合

使用 `GridShell`、`GridToolbar`、`GridTable`、`GridFooter` 等原子组件重组官方配方，用来验证 Headless 实例和 Ant Design 组件之间没有固定布局耦合。

### 开发文档

提供最小接入示例和专题文档导航。仓库中的完整文档位于 `docs/`，并随 npm 包一起发布。

## 建议验收路径

1. 搜索唯一订单号，确认表格结果与右侧 `keyword` 请求一致。
2. 添加“状态属于任意一个已完成”筛选，再按金额排序并切换分页。
3. 分别单击行、点击订单号，并双击状态完成快捷编辑。
4. 新建订单，编辑金额，通过“更多”复制后删除副本。
5. 选择当前页，再升级为“选择全部匹配项”，最后取消选择。
6. 选择两行执行批量完成，并验证选择在成功后清空。
7. 导出当前查询，确认浏览器下载 UTF-8 CSV 文件。
8. 在数据源实验室依次验证 Remote 错误/恢复、空态、Local 和 Controlled 搜索。
9. 调整字段或视图后刷新页面验证偏好，再用“恢复出厂”清除。

所有远程读取和写入都由浏览器内的 mock API 模拟，但 Remote 读取只接收编译后的 `GridRequestQuery`，不会绕过传输协议直接消费 UI query。
