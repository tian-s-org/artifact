# AGENTS.md

给在这个仓库里工作的 Agent（Claude Code 等）的说明。用户看的是 `README.md`。

## 这个仓库是什么

Agent 原生的无限设计画布。**画布是只读的**：没有编辑按钮、没有属性面板，改设计只能改文件。
你写 `<项目>/.artifact/artboards/<画板>/index.html`，用户开着的画布会自己换那一块。
仓库本身不带示例项目：项目的根由画布启动时的 `--projects`（默认当前目录的 `.artifact/`）决定。

- `packages/canvas` 是**底座**（`@tian-s-org/canvas`）：无限画布 SPA + 本地服务。它可发布，装进任意项目就能起画布。
- `apps/cloud` 是云端画布（Cloudflare Worker + R2，线上 `artifact.tianyw0.xyz`），跑的是同一份前端。
- `packages/canvas-core` 是画布引擎（`@tian-s-org/canvas-core`，无 React，两版共用）。
- `packages/schema` 是画布协议（`@tian-s-org/schema`：`canvas.json` 解析校验 + 新建骨架），本地、云端、前端共用。
- `packages/artifact-cli`（`@tian-s-org/artifact-cli`）负责装技能与起画布；它依赖底座，`npx @tian-s-org/artifact-cli canvas` 不需要仓库在场。

四个 `@tian-s-org/*` 包发布到 GitHub Packages（私有），发布步骤见文末「发布」。

## 动手前先读

1. `<项目>/.artifact/context.md`——项目背景、目标用户、约束。
2. `<项目>/.artifact/design-system/`——颜色、字号、间距的令牌与规则；画板要按它来。
3. 已有的画板：照着现有风格、尺寸和排版节奏做，别另起一套。

## 常用命令

在仓库根目录：

```bash
pnpm dev                                  # 开发：http://127.0.0.1:4330
pnpm build && pnpm start                  # 生产：单进程
pnpm new-board <项目> "包装刀版线"         # 新建画板骨架（可 --id board-004 --size 1440x900）
pnpm versions save <项目> "配色定稿"       # 存一版
pnpm versions list <项目>
pnpm versions restore <项目> <版本 id> [--board board-001]
pnpm typecheck && pnpm test && pnpm test:e2e

# 云端
pnpm --filter @tian-s-org/cloud test     # worker 直测（内存版 R2）
pnpm cloud:push <项目 id…>               # 把本地项目推到线上
pnpm cloud:deploy                        # 重新打包 SPA 并部署 Worker
pnpm --filter @tian-s-org/cloud smoke    # 真浏览器冒烟线上画布
```

`pnpm new-board` 与 `pnpm versions` 直接读写项目目录，不需要服务在跑；服务开着时改完自动刷新。

## 新建画板

1. `pnpm new-board <项目> "<画板名>"`：它会在 `canvas.json` 里登记（自动摆在现有画板右边）并写出骨架 HTML。
2. 把骨架 HTML 换成真的设计。画板尺寸以 `canvas.json` 里的 `width`/`height` 为准，HTML 铺满即可。

手写 `canvas.json` 也可以，字段见 README。画板 `id` 同时是目录名，只能用 `board-001` 这种小写连字符名。

## 修改画板

- 直接编辑 `artboards/<画板>/index.html`，存盘即生效；只重载这一块，不影响别的画板。
- 画板之间相互独立：同名 class 不会串（每块画板在自己的 iframe 里）。
- 放大要清楚：用矢量 SVG、真文本、1px 边框；不要用位图截图，也不要把整页包在 `transform: scale()` 里。

## 画板 HTML 的硬约束

- **没有 JavaScript**。iframe 是 `sandbox=""`，脚本不会执行；交互态请用 CSS（`:hover`、`@media`、`details` 等）。
- 不引用外网资源。画板文档的 CSP 只允许本地服务与 `data:`；外链图片、CDN 字体会被拦掉。
- 资源用相对路径：`../../assets/images/xxx.png`、`../../assets/fonts/xxx.woff2`、
  `../../design-system/…`（`design-system/` 下的文件也能被画板当 CSS 引用，示例项目没这么做，各自把令牌写在画板里）。
- 不访问父页面、不发请求——沙箱与 CSP 都会拒绝，别在这上面浪费时间。

## 摆位与布局

- 坐标原点在左上，x 向右、y 向下，单位是画布像素（不是屏幕像素）。
- 画板横向排开、留 160px 以上间隔；同一组方案并排，别重叠。
- 用户拖动画板会写回 `canvas.json` 的 `x`/`y`；你读到的就是最新位置。

## 版本

大改之前存一版（`pnpm versions save <项目> "<这版是什么>"`），改动有风险时先存再动。
恢复只写目标文件：`--board` 只恢复那一块画板，`canvas.json` 和其他画板不动；恢复前会自动备份当前状态。

## 禁止事项

- 不给画布加编辑能力（绘图工具、图层面板、属性面板、画板内编辑）。这是产品边界，不是没做完。
- 不为某一块画板去改 `packages/canvas-core` 的行为；要改就改得对所有画板都成立，并跑 E2E。
- 不把 `canvas.json`、`context.md`、`versions/` 放到 `/files` 能取到的地方。
- 不往项目里放大体积位图或构建产物；画板是手写 HTML。
- 没有用户明确要求，不 commit、不 push、不加 CI。

## 改云端

- 两版共用一份前端（`packages/canvas/src` 打包进 `apps/cloud/web`）。前端调一个新接口，`apps/cloud/src/api.ts`
  里就得有对应实现，否则云端 404。
- **写操作一律 `POST`**：Cloudflare 在边缘就把 `PUT`/`PATCH`/`DELETE` 挡成 403（到不了 Worker）；
  删文件用 `POST …/file?op=delete`。接口路径里别出现 `config`（WAF 会拦），所以那条叫 `/api/meta`。
- 画板永远从文件源 `artifact-files.tianyw0.xyz/f/<pid>/<令牌>/…` 加载，iframe 的 `sandbox=""` 不加 `allow-same-origin`；
  文件源除了 `/f/` 什么都不发。这两条是云端的安全本质，别为了方便放宽。
- 密钥只放 `apps/cloud/.dev.vars`（已 gitignore）或 `wrangler secret`；`SITE_KEY`、`FILES_SECRET` 不进代码、不进文档、不进提交。

## 改应用壳

应用壳（`packages/canvas/src`，云端共用）的样式一律写成 Tailwind v4 工具类；`app.css` 里只留 `@theme` 令牌和
`html/body` 的底，不再添组件规则。

- `--spacing: 1px`：间距、尺寸按像素写，`p-8` 就是 8px，`h-45` 就是 45px，量多少写多少。
- 颜色只从令牌取（`text-ink-2`、`bg-surface`、`border-line`…）；`calc()` 里的空格写成 `_`，例如
  `bottom-[calc(100%_+_6px)]`。
- `.board`、`.board-frame`、`.focus-layer`、`.focus-head`、`.canvas-tools`、`.board-id`、`.vp-*`
  这些类名是 E2E 与 `IframeCanvas` 的挂点，改样式时原样留着，别当死类名删掉。
- 画布网格由 `packages/canvas-core` 直接写到 `background` 上，别在 CSS 里再画一层。

## 发布（GitHub Packages）

四个包都发到 `https://npm.pkg.github.com/`，scope 必须是仓库 owner `@tian-s-org`。
本地 `.npmrc`（不提交）配 `@tian-s-org:registry` 与 `_authToken` 后，按依赖序发：

```bash
pnpm --filter @tian-s-org/schema publish
pnpm --filter @tian-s-org/canvas-core publish
pnpm --filter @tian-s-org/canvas publish       # prepack 会先 vite build，dist 打进 tarball
pnpm --filter @tian-s-org/artifact-cli publish
```

- 发布前提：GitHub 上有 `tian-s-org/artifact` 仓库；token 需要 `write:packages`。
- `workspace:*` 由 pnpm 在打包时换成真实版本号；包之间升级版本要一起发。
- token 只落本地 `.npmrc` 或发布时的环境，**不进仓库、不进文档**。
- 发完在一个干净目录 `npm i @tian-s-org/artifact-cli && npx @tian-s-org/artifact-cli canvas --projects <dir>` 冒烟。

## 验证改动

```bash
pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build
```

E2E 会在临时目录里起真实服务与浏览器，不会碰本地项目目录。
改前端时用 `pnpm dev` 自己看一眼，别只看测试绿。
