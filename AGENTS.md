# AGENTS.md

给在这个仓库里工作的 Agent（Claude Code 等）的说明。用户看的是 `README.md`。

## 这个仓库是什么

Agent 原生的**只读设计画布**。agent 把设计写成静态 HTML 画框（`<项目>/.artifact/`），
`artifact push` 到 Cloudflare（Worker + R2），浏览器只读查看。没有编辑器，改设计就改文件。

- `src/`：画布壳（React）——`core` 视口数学、`protocol` 协议校验、`shell` 画框、`store` 轮询、`api` 请求
- `worker/`：云端运行时——`/api/state`、`/api/file(s)`、`/f/<令牌>/<路径>`、Google 登录
- `cli/`：`artifact login / logout / push / open / skill install`
- `skills/artifact-canvas/`：随包发布的技能（`SKILL.md` + references + assets + scripts）
- `tests/`：unit（协议、deep-link）· cli（安装器）· worker（API、鉴权、路径）

## 常用命令

```bash
pnpm install
pnpm typecheck && pnpm test && pnpm build
pnpm dev:worker                  # wrangler dev --var DEV:1
pnpm deploy                      # vite build + wrangler deploy
node cli/artifact.mjs skill install --target all --force
```

## 协议要点

- 一块画布一个随机 id；清单是 `layout.json`（`protocol / id / name / context / boards[]`）
- 一个人可以有多块画布：`artifact list` 看自己的，`/c/<id>` 是只读分享链接
- 画框文件必须是 `artboards/<id>/index.html`；画框可以有自己目录里的 CSS/图片
- 共享资源放 `assets/{images,fonts,css}/`
- 没有版本、没有多项目、没有本地 Node 服务

## 画框 HTML 的硬约束

- **没有 JavaScript**：iframe `sandbox=""`，脚本不执行；交互态只用 CSS
- **不引用外网**：CSP 只放行文件源与 `data:`
- 资源用相对路径；矢量 SVG + 真文本，放大要清楚

## 改动约定

- 画布是只读的：不加编辑能力、不加拖拽布局、不加版本面板
- 画布的视觉：Tailwind v4 工具类，`--spacing: 1px`（`p-8` = 8px）；颜色只从 `@theme` 令牌取
- `.board`、`.board-frame`、`.focus-layer`、`.canvas-tools`、`.board-index`、`.board-label`、`.board-spec` 是测试/选择器挂点，别删
- 画框标签是 `01 名称`（序号 + 名称），**固定 12.5px 屏幕字号**：世界层 zoom 时用 `transform: scale(1/scale)` 反向缩放；
  名称自带编号（`2.1 主界面`）时不再补序号（`OWN_NUMBER` 判断）
- 画框 iframe 默认 `pointer-events-none`（不然拖画布会被吃掉）；按住 ⌥ 或进聚焦层才把指针让进去
- 点阵网格跟世界缩放（间距 = 24px × scale，不代表屏幕密度），缩到 20% 以下淡出、50% 以上全显（`gridSpacing` / `gridOpacity`）
- 内部模块名 `@tian-s-org/schema`、`@tian-s-org/canvas-core` 由 tsconfig paths 指向 `src/protocol`、`src/core`
- 云端写操作一律 `POST`（Cloudflare 边缘挡 PUT/PATCH/DELETE）；接口路径不要出现 `config`（WAF）
- 密钥只放 `.dev.vars`（gitignore）或 `wrangler secret`，不进代码、文档、提交

## 发布

```bash
# GitHub Packages（私有）；token 只落本地 .npmrc（已 gitignore）
pnpm publish --no-git-checks
```

发布前跑 `pnpm typecheck && pnpm test && pnpm build`。

## 验证改动

```bash
pnpm typecheck && pnpm test && pnpm build
```

改前端时 `pnpm dev:worker` 自己看一眼；没有 Google 配置时是「全放开」模式。
