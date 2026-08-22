# 维护、兼容性与发布

本页面向包维护者。业务应用的接入要求见[快速开始](./getting-started.md)。

## 支持矩阵

| 能力             | 支持范围                                                     |
| ---------------- | ------------------------------------------------------------ |
| React            | 18.x、19.x                                                   |
| React DOM        | 18.x、19.x，必须与 React 主版本一致                          |
| Ant Design       | 6.x                                                          |
| Ant Design Icons | 6.x                                                          |
| Node.js          | 包声明为 `>=20.19 <27`；仓库 CI、npm 发布和 Vercel 使用 24.x |
| TypeScript       | 使用现代包导出解析：`Bundler`、`Node16` 或 `NodeNext`        |
| 包格式           | ESM、CommonJS、`.d.mts`、`.d.cts` 与独立 `style.css`         |

旧的 `moduleResolution: "node"` 不理解 `package.json#exports`，因此不支持
`@huiyun/data-grid/core` 等子路径。包不会用 `typesVersions` 制造“类型可以解析、运行时代码却无法解析”的半兼容状态。旧项目应迁移到 `Bundler`、`Node16` 或 `NodeNext`。

## 本地发布门禁

仓库使用 `packageManager` 字段锁定 pnpm 版本，并用 `.nvmrc` 与 `.node-version` 将维护环境统一为 Node.js 24。

```bash
pnpm install --frozen-lockfile
pnpm release:check
```

`release:check` 会依次执行：

1. 格式、TypeScript、单元测试、库构建和 Demo 构建；
2. 带最低阈值的 V8 覆盖率检查；
3. npm tarball 内容检查；
4. publint 与 Are the Types Wrong 的现代 Node/TypeScript 解析检查；
5. 从实际 tarball 创建临时消费项目，验证 ESM、CommonJS、四个入口、CSS、服务端真实渲染和两种 TypeScript module resolution。

React 18 的额外本地消费验证可单独运行：

```bash
pnpm build
pnpm consumer:smoke -- --react=18
```

CI 会并行验证 React 18 和 React 19。覆盖率基线是保护线，不是完成目标；增加测试后应逐步提高阈值，不应通过扩大 exclude 来规避下降。

GitHub 的 `main` ruleset 应要求 Pull Request 和以下 checks 全部成功后才能合并：`Quality and coverage`、`Package contract`、`Consumer smoke / React 18`、`Consumer smoke / React 19`。这样 Vercel 的 production branch 只会接收到通过门禁的提交；Pull Request 仍可正常生成 Preview。

## Vercel Demo

Vercel Demo 固定在 Node.js 24：

- `examples/demo/package.json` 声明 `24.x`；
- `.nvmrc`、`.node-version` 与 GitHub Actions 使用 Node 24；
- `vercel.json` 在构建前校验实际 major，防止平台升级后静默漂移。

同时在 Vercel 的 **Project Settings → Build and Deployment → Node.js Version** 选择 `24.x`。Vercel 会自动更新同一 major 的安全补丁。

## npm Trusted Publishing

发布工作流是 `.github/workflows/publish.yml`，只在 GitHub Release 变为 `published` 时执行。它会校验 Release tag 必须严格等于 `v${package.json.version}`；稳定版本发布到 `latest`，预发布版本发布到 `next`。

npm 只能为已经存在的包配置 Trusted Publisher。因此 `@huiyun/data-grid` 的首次 bootstrap 发布必须由维护者在本机完成：

```bash
pnpm release:check
npm login
npm publish --access public --provenance=false
```

`--provenance=false` 只用于这一次本地 bootstrap，因为 provenance 不能在普通本机发布中生成；后续 OIDC 发布会自动恢复 provenance。本地 npm 账户必须启用 2FA；发布完成后退出登录，并删除本机或 CI 中不再需要的 token。也可以使用只允许该包发布且短有效期的 granular token 做一次性 CI bootstrap，但完成后必须立即撤销，不能把它保留为长期自动化凭证。

确认包已经出现在 npm 后，在包设置中创建 GitHub Actions Trusted Publisher：

- organization/user：`stevenleep`
- repository：`data-grid`
- workflow filename：`publish.yml`（只填文件名）
- environment：`npm`
- allowed action：`npm publish`

同时在 GitHub 仓库创建名为 `npm` 的 Environment，建议要求维护者审批，并把 deployment tag 限制为 `v*`。工作流只授予 `contents: read` 与发布 job 的 `id-token: write`，不需要保存长期 `NPM_TOKEN`。验证第一次 OIDC 发布成功后，应撤销 bootstrap token，并在 npm 中禁止 token 发布（如团队策略允许）。

Trusted Publishing 要求 GitHub-hosted runner、Node.js 22.14+ 与 npm CLI 11.5.1+。发布 job 使用 Node 24，并在发布前检查 npm 版本；OIDC 发布会自动生成 provenance。配置依据见 [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)。

## 发布步骤

1. 若包尚不存在，按上面的 bootstrap 流程完成首次发布和 Trusted Publisher 配置。
2. 更新版本与 `CHANGELOG.md`，运行 `pnpm release:check`。
3. 合并到受保护的 `main`，确认 CI 全部通过。
4. 创建与版本一致的 tag，例如 `v0.1.1`，并发布 GitHub Release。
5. GitHub `npm` Environment 审批通过后，工作流执行 `npm publish`。
6. 在 npm 查看版本、dist-tag 与 provenance，并从空项目安装一次最终版本。

不要手工复用 npm automation token。若发布 job 在 OIDC 交换前失败，优先核对 npm 中的仓库名、workflow 文件名和 environment 是否与上述值逐字一致。
