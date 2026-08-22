# @huiyun/data-grid 使用文档

这套文档面向三类读者：第一次接入列表页的业务开发者、需要封装平台能力的基础设施开发者，以及负责接口协议的后端开发者。

## 文档导航

| 文档                                             | 解决的问题                                                 |
| ------------------------------------------------ | ---------------------------------------------------------- |
| [快速开始](./getting-started.md)                 | 安装、最小定义、远程分页和第一个页面                       |
| [架构与设计原则](./architecture.md)              | Core、React、AntD 三层如何协作，哪些边界是有意保留的       |
| [字段、列与值类型](./definition.md)              | 如何描述任意字段、关系数据、动态选项、分组表头和传输字段   |
| [数据源](./data-sources.md)                      | Local、Remote、Controlled 的选择、能力声明、取消和缓存     |
| [查询与传输协议](./query-protocol.md)            | 搜索、嵌套筛选、多字段排序、分页和投影怎样发送给后端       |
| [CRUD 与交互](./interactions-and-crud.md)        | 新增、查看、编辑、删除、行点击、值点击、批量动作和快捷编辑 |
| [自由组合](./composition.md)                     | 如何替换默认布局、单独使用面板和接入业务组件               |
| [状态、视图与持久化](./state-and-persistence.md) | Slice 受控、命名视图、用户偏好和 revision 迁移             |
| [性能与生产建议](./performance.md)               | 服务端分页、请求竞争、缓存、渲染和稳定引用                 |
| [API 索引](./api-reference.md)                   | 公共入口、核心类型、实例 API 和 AntD 组件索引              |
| [故障排查](./troubleshooting.md)                 | 常见接入错误、查询不刷新、筛选无效和发布检查               |
| [维护与发布](./releasing.md)                     | 兼容矩阵、包消费烟测、Vercel 和 npm Trusted Publishing     |

## 推荐阅读路径

- 普通业务列表：快速开始 → 字段与列 → CRUD 与交互。
- 接后端查询接口：数据源 → 查询与传输协议 → 性能建议。
- 建设低代码或配置平台：架构 → JSON Schema 与 Runtime → 自由组合。
- 封装公司级列表组件：自由组合 → 状态与持久化 → API 索引。

## 版本约定

- `definition.id` 是列表的稳定身份，不要使用随机值。
- 字段、列或持久化结构发生不兼容变化时提升 `revision`。
- 查询协议当前由包内 TypeScript 类型约束；JSON Schema 协议标识为 `huiyun.data-grid/v1`。
- 文档以仓库当前版本为准，发布前由 `pnpm release:check` 执行完整门禁。
