# 维护、兼容性与发布

本页面向包维护者。业务应用的接入要求见[快速开始](./getting-started.md)。

## 支持矩阵

| 能力             | 声明范围                                            | CI 验证                                                              |
| ---------------- | --------------------------------------------------- | -------------------------------------------------------------------- |
| React            | `>=18.0.0 <20.0.0`                                  | 18.0.0、18.3.x、19.0.0、19.2.x                                       |
| React DOM        | `>=18.0.0 <20.0.0`，应与 React 主版本一致           | 与上述 React 版本成对验证                                            |
| Ant Design       | `>=6.0.0 <7.0.0`                                    | 6.0.0 与当前 lockfile 版本                                           |
| Ant Design Icons | `>=6.0.0 <7.0.0`                                    | 6.0.0 与当前 lockfile 版本                                           |
| Node.js          | `>=20.19.0 <27`                                     | 20.19.0 下界、24/26 当前线                                           |
| TypeScript       | 5.4–7.x，使用现代包导出解析                         | 5.4.5 下界、仓库 5.9.x 与当前 7.0.x；`Bundler`、`Node16`、`NodeNext` |
| 包格式           | ESM、CommonJS、`.d.mts`、`.d.cts`、独立 `style.css` | 实际 npm tarball 的 Node 加载、TS 解析和 Vite 构建                   |

`@huiyun/data-grid/core` 不需要 React、React DOM、Ant Design 或图标包。四个 UI peer 在包元数据中都是 optional，只用 Core 的服务或工具不会被迫安装 UI 栈。使用 `/react`、`/antd` 或根入口时，消费应用必须显式安装它实际使用的 peers。

Core-only 声明在 `skipLibCheck: false` 下验证。完整 AntD 消费项目使用 `skipLibCheck: true`，因为 AntD 6/rc-component 当前声明在 React 18 类型下存在上游库内部冲突；这不会跳过消费项目自身或 Data Grid API 的类型检查。必须对所有第三方 `.d.ts` 开启严格库检查的团队，需在锁定 AntD/React/TypeScript 组合前单独验证上游兼容性。

旧的 `moduleResolution: "node"` 不理解 `package.json#exports`，因此不支持 `@huiyun/data-grid/core` 等子路径。旧项目应迁移到 `Bundler`、`Node16` 或 `NodeNext`。

## 本地发布门禁

使用仓库声明的 pnpm 版本和 Node.js 24：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm release:check
```

`release:check` 只执行一次每类验证：

1. Prettier、TypeScript 与带阈值的测试覆盖率；
2. 库构建、Demo 类型/构建与 gzip 预算；
3. npm tarball 内容、publint 与 Are the Types Wrong；
4. 只有 Core 且没有 UI peers 的消费项目；
5. React 18/19 与 AntD 6 的下界/当前版本，以及从真实 tarball 构建的 Vite 应用。

快速定位时可分层运行：

```bash
pnpm quality:check
pnpm package:check
pnpm consumer:smoke:core
pnpm consumer:smoke:minimum
pnpm consumer:smoke:current
```

## GitHub 平台清单

以下是维护者必须在 GitHub 网页完成并定期复核的外部设置；仓库文件无法证明它们已生效：

- 为 `main` 启用 ruleset/branch protection，要求 Pull Request、禁止 force push，并要求以下 checks：
  - `Quality and coverage`
  - `Package contract`
  - `Consumer smoke / Core only / Node 20 minimum`
  - `Consumer smoke / Core only / Node 26 current`
  - `Consumer smoke / React 18 + AntD 6 + TS 5.4 minimum`
  - `Consumer smoke / React 18 current`
  - `Consumer smoke / React 19 + AntD 6 + TS 5.4 minimum`
  - `Consumer smoke / React 19 + TS 7 current + packed Vite`
- 建立名为 `npm` 的 GitHub Environment；要求维护者审批，并将 deployment tag 限制为 `v*`。
- 确认 Actions 允许运行仓库内 workflow，且组织计费/配额没有让必需 checks 变成空跑或失败。
- 在 **Settings → Security → Code security** 复核 Dependabot alerts/security updates 与通知接收人；`dependabot.yml` 只能定义常规版本更新，不能替代这些平台开关。
- 每次发版前在一个 PR 上确认 ruleset 真的阻止绕过门禁的合并。

Dependabot 只负责提出 npm 和 GitHub Actions 更新 PR，不会自动合并或代替上述保护规则。

## Vercel Demo

Vercel 项目应把 **Root Directory** 设为 `examples/demo`。这样平台会读取该目录中的 `package.json` 和 `vercel.json`：

- Node.js：`24.x`；
- Install Command：`pnpm install --frozen-lockfile`；
- Build Command：`node ../../scripts/assert-node-major.mjs 24 && pnpm build`；
- Output Directory：`dist`。

还必须在 **Project Settings → Build and Deployment → Node.js Version** 选择 `24.x`，并确认 production branch 是受保护的 `main`。Root Directory 和 production branch 是 Vercel 外部配置，无法由 `vercel.json` 固化；不要因为仓库内存在配置文件就假定线上项目已对齐。

根目录 `vercel.json` 仅用于兼容尚未迁移 Root Directory 的旧项目；它同样在构建前强制 Node 24。新项目和迁移完成的项目以 `examples/demo` 为唯一 Root Directory。

Demo 构建会拆分 React、AntD 和图标 chunk，并执行两个 gzip 预算：单个 JavaScript chunk 不超过 150 KiB，所有 JavaScript chunk 合计不超过 500 KiB。只能在评审确认业务必需时通过 `DEMO_MAX_CHUNK_GZIP_KIB` 和 `DEMO_MAX_TOTAL_GZIP_KIB` 调整预算。

## npm Trusted Publishing 与首发

`.github/workflows/publish.yml` 只在 GitHub Release 变为 `published` 时运行。它将权限分为两个 job：

1. `Verify and package release` 只有 `contents: read`：校验 tag/版本/main、跑完整门禁，生成唯一 tarball 和 SHA-256；
2. `Publish trusted artifact` 才获得 `id-token: write`：不 checkout、不安装仓库依赖、不重新构建，只下载并验证前一 job 的 artifact 后发布。

稳定版发布到 `latest`，预发布版发布到 `next`。npm Trusted Publishing 当前要求 GitHub-hosted runner、Node.js 22.14+ 和 npm CLI 11.5.1+；发布 job 使用 Node 24 并在发布前检查 npm 版本。官方要求见 [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)。

npm 要求包已存在才能绑定 Trusted Publisher。首次 bootstrap **不能使用正式 Release 即将发布的同一版本**；npm 版本号一旦发布永久不可复用。安全的最小流程是用同一个未来稳定版的专用预发布号：

先在 npm 网页确认发布账户是 `@huiyun` 组织成员且拥有该包名的发布权限；这也是外部设置，仓库无法自行保证。

```bash
# 示例：正式目标是 0.2.0，bootstrap 使用独立且不可复用的版本
pnpm version 0.2.0-bootstrap.0 --no-git-tag-version
pnpm release:check
npm login
npm publish --access public --tag bootstrap --provenance=false --ignore-scripts
```

然后在 npm 包设置中建立 GitHub Actions Trusted Publisher：

- organization/user：`stevenleep`；
- repository：`data-grid`；
- workflow filename：`publish.yml`（只填文件名）；
- environment：`npm`；
- allowed action：`npm publish`。

与此同时完成上述 GitHub `npm` Environment。随后把仓库版本设为真正目标稳定版（例如 `0.2.0`），更新 lockfile 和 `CHANGELOG.md`，并走完 PR 与 Release。`0.2.0-bootstrap.0` 与 `0.2.0` 是两个不同 npm 版本，不会冲突。

bootstrap 预发布号不创建 Git tag 或 GitHub Release；只有恢复为正式版本并通过 PR 后才创建 `vX.Y.Z` Release。

bootstrap 是唯一一次性的本地发布：账户必须启用 2FA，不得把长期 token 写入 GitHub/Vercel/仓库。验证第一次 OIDC 发布后，退出本机 npm 会话、撤销一次性 token，并在组织策略允许时禁止 token 发布。OIDC 成功时 npm 会自动生成 provenance。

## 正式发布步骤

1. 确认 npm Trusted Publisher、GitHub `npm` Environment、`main` ruleset 和 Actions 计费/配额都已在平台端复核。
2. 更新 `package.json` 版本、`pnpm-lock.yaml` 和 `CHANGELOG.md`，运行 `pnpm release:check`。
3. 通过 Pull Request 合并到受保护的 `main`，确认所有必需 checks 成功。
4. 在 `main` 的该提交上创建与版本一致的 tag，例如 `v0.2.0`，再发布 GitHub Release。
5. 审批 GitHub `npm` Environment，等待 `Verify and package release` 与 `Publish trusted artifact` 均成功。
6. 在 npm 核对版本、dist-tag 和 provenance；从空目录安装最终版本并执行一次 Core 与 Vite 消费验证。

不要先创建 GitHub Release 再补版本、修 CI 或调整 tarball；Release 一旦 `published` 就会触发发布 workflow。若 OIDC 交换失败，先逐字核对 npm 的 repository、workflow filename、environment 与 allowed action，不要改回长期 `NPM_TOKEN`。
