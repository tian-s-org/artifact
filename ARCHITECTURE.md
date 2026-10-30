# artifact 架构（v2 · 云端版）

> 状态：2026-10-30 讨论定稿，**代码仍是 v1**（本地 + 云端、多项目、四个包）。
> 本文是实施目标；改动按文末「实施阶段」推进。

## 1. 一句话

Agent 把设计写成静态 HTML 画板，`push` 到云端；浏览器打开一块**只读的无限画布**，看、并排比较、聚焦、全屏。

## 2. 核心模型

```
一个画布 = 一个目录
├── layout.json                 画框清单（位置、尺寸、名字、文件）
├── context.md                  可选：给 agent 读的背景
├── artboards/<id>/index.html   设计本体（静态 HTML，无脚本；可带自己的 CSS/图片）
└── assets/{images,fonts,css}/  可选：跨画板共享的资源
```

- **一块画布 = 一个随机 id 链接**（`/c/<id>`）：链接只决定看哪一块，**看也要登录**（白名单账号）；一个人可以有多块。
- **只读**：画布不能编辑，写只发生在 push 与 HTTP 接口。
- **画布无限大**：多个画框靠坐标分区（品牌区、架构区、UI 区……）。
- **文件即真源**：本地目录是工作副本，云端是同一份结构的镜像。

## 2.1 仓库结构（根目录即包）

只有一个包，不需要 pnpm workspace：

```
artifact/
├── package.json            @tian-s-org/canvas；bin: artifact
├── pnpm-lock.yaml
├── tsconfig.json
├── vite.config.ts
├── index.html              SPA 入口
├── wrangler.jsonc          两个域名 + R2
├── README.md · AGENTS.md · ARCHITECTURE.md
├── .gitignore
│
├── src/                    浏览器里的只读画布
│   ├── core/               viewport / gestures / geometry
│   ├── protocol/           layout.json 校验 + 骨架模板
│   ├── shell/              IframeCanvas / BoardFrame / FocusOverlay / deep-link
│   ├── store/              project-store（轮询 /api/state）
│   └── api/client.ts
│
├── worker/                 云端运行时
│   ├── index.ts · api.ts · files.ts · storage.ts · auth.ts · paths.ts
│
├── cli/                    artifact push / open / skill install
│   └── artifact.mjs        shebang 入口
│
├── skills/artifact-canvas/ SKILL.md + references/ + assets/ + scripts/
│
└── tests/                  unit · worker · e2e（wrangler dev + Playwright）
```

没有 `apps/`、没有 `packages/`、没有本地 Node 服务、没有 `versions/`。

## 3. 运行时

```
                    ┌──────────────────────────────┐
agent ──artifact push──▶ /api/file(s) ──▶ R2        │
                    │   Worker（一个部署）            │
浏览器 ──GET /──────▶ SPA（Assets）                 │
浏览器 ──GET /api/state（2.5s 轮询）──▶ R2            │
画板 iframe ──GET────▶ files 域 /f/<hmac>/<rel> ──▶ R2 │
                    └──────────────────────────────┘
```

- **app 域**：SPA + `/api`，`SITE_KEY` 门禁（`?k=` 换 Cookie；脚本用 Bearer）。
- **files 域**：只发 `/f/<令牌>/<相对路径>`，画板 iframe 的来源；沙箱 CSP。
- **刷新**：轮询 `/api/state`（layout.json + 每块画板 mtime），变化才换 iframe。
- **写操作一律 `POST`**：Cloudflare 边缘会挡 `PUT`/`PATCH`/`DELETE`；接口路径别带 `config`（WAF）。

## 4. 需求

### 4.1 查看器（只读）

| 需求 | 说明 |
| --- | --- |
| 无限画布 | 拖空白平移、滚轮/触控板缩放、指针锚定 |
| 取景 | 适应全部、100%、当前百分比 |
| 画框标签 | 常显 id + 名字 |
| 尺寸开关 | 工具栏 toggle；打开后悬停画框显示蓝描边 + `名字 · 宽 × 高`（Figma 式），状态记在本机 |
| 聚焦 | 双击画框按视口重排；←/→ 切换；F 全屏 |
| 全屏 | 45px 查看器横栏（还原/关闭），Esc 逐级退出 |
| 深链 | `?focus=<画板 id>&scale=<0.2–4>` |
| 刷新 | 只重载变化的那一块，120ms 淡入不白闪 |
| 缺失兜底 | 登记了但文件不存在时显示错误态 |

### 4.2 创作与写入

| 需求 | 说明 |
| --- | --- |
| `artifact push` | 本地目录整包上传；**直接传源文件，不编译** |
| 单文件接口 | `GET/POST /api/file`；删用 `?op=delete` |
| 文件树 | `GET /api/tree`，agent 看云端有什么 |
| 新建画框 | 改 `layout.json` + 建 `artboards/<id>/index.html` |
| 限制 | 单文件 ≤ 8MB、单包 ≤ 200 文件 |

### 4.3 云端运行时

| 需求 | 说明 |
| --- | --- |
| 单画布 | R2 前缀固定（如 `canvas/`），不再有 `<pid>/` |
| 状态接口 | `GET /api/state` → layout.json + 每块画板 mtime |
| 轮询 | 约 2.5 秒；Workers 不做长连 SSE |
| 二进制 | base64 编码写入 |

### 4.4 安全不变量

1. 画板 iframe 永远 `sandbox=""`，**永不加** `allow-same-origin`。
2. 画板 CSP：`script-src 'none'`、`connect-src 'none'`，只放行文件源与 `data:`。
3. `/files` 只发 `artboards/`、`assets/`；`layout.json`、`context.md` 一律 403。
4. 写接口需要 Bearer（CLI token）；app 页面需要 Google 会话；两者都可撤销。
5. 密钥只放 `.dev.vars`（gitignore）或 `wrangler secret`，不进代码、文档、提交。

### 4.5 CLI 与技能

```
artifact login            # 打开浏览器授权，本地保存 token
artifact push [目录]      # 本地 .artifact → 云端（默认当前目录）
artifact open             # 打开画布链接
artifact skill install    # 装技能
```

技能指导 agent：建 `.artifact/` → 写画板 → `push` → `open`；并说明尺寸开关与只读边界。

### 4.6 身份与授权（2026-10-30 新增）

**Web 用 Google 登录**：

- OAuth 2.0（授权码），回调 `/auth/google/callback` 后种一枚签名 HttpOnly Cookie 作为会话（30 天）；
- 只允许白名单邮箱 / 域名登录（`ALLOWED_EMAILS` / `ALLOWED_DOMAIN`），其他人看到 403；
- **不再使用 SITE_KEY**：没配 Google 时是本地开发模式（全放开）；配了就必须登录。

**本地 skill 由 Web 授权**：

```
artifact login
  ├─ CLI 起一个一次性回调地址（127.0.0.1:<随机端口>）
  ├─ 打开浏览器 → /cli/authorize?redirect=…&state=…
  ├─ 用户在 Web 上已登录（Google），点「允许」→ 回调带上一次性 code
  └─ CLI 用 code 换长期 token，存 ~/.config/artifact/credentials.json（0600）
```

- 一次性 code 存 R2 `auth/codes/<code>`（10 分钟、用后即焚），换来的 token 存哈希 `auth/tokens/<sha256>`；
- `artifact push` 用 `Authorization: Bearer <token>`；
- 会话与文件令牌都用 `SESSION_SECRET`（不设则复用 Google client secret）签名——本地开发不需要任何额外密钥。

**待定**：

1. Web 上的「本地授权」列表与撤销（token 已有存储，界面还没做）。
2. 画布归属：每块画布的 owner 是创建它的 Google 账号；暂不支持转移或协作者。
3. token 有效期（当前长期有效）与撤销粒度（按设备）。

## 5. push 的语义

- **push 的是源文件**：HTML / CSS / SVG / 图片 / 字体 / `layout.json`，目录结构原样。
- **不做构建**：没有打包、没有转译、没有内联。文件源支持多文件，所以不需要像 Claude Artifact 那样把一切塞进一个 HTML。
- **画板不是 React**：画板运行在 `sandbox=""` 里，脚本不执行；React 只存在于画布壳。
- **画布壳才用 React**：Vite 构建成静态产物，由维护者 `wrangler deploy` 到 Cloudflare Assets——这不是 agent 的 push。
- **组件化的正确姿势**：共享 CSS 放 `assets/css/`，画板用相对路径引用，而不是引入 JS 框架。

## 6. 参考 Claude Artifact：抄什么、不抄什么

**抄**：

- 发布 = 稳定 URL + 原地更新，agent 不用管版本号；
- 动作少：发布 / 读回 / 列表；
- 默认私有，分享靠显式动作；
- agent 能回读自己发出去的东西（`/api/state` 就是我们的回读）；
- 页面契约明确（我们：无脚本、不引外网、相对路径、矢量清晰）。

**不抄**：

- 托管绑定账号——账号一封，云端记录全失（本项目的真实教训）；
- 平台门槛（要订阅、要登录、API key 不行）；
- 过度的沙箱限制（不能下载、不能打印、外部 iframe 全禁）；
- artifact id 作为唯一句柄——我们用文件路径；
- 一页一个 artifact、无法并排比较——画布正是为此存在。

## 7. 明确不做

- 画布内编辑（绘图、图层、属性面板、画板内编辑）
- 拖拽调整画框（只读）
- 版本管理（文件本身就是版本，交给 git）
- 多画布 / 多项目
- 本地 Node 服务（开发用 `wrangler dev`）
- 评论、账号体系、计费

## 8. 待定

1. ~~写入主路径~~ 已定：**本地目录 + push**；单文件改动也可走 HTTP 接口。
2. ~~`SITE_KEY` 与文件令牌的轮换~~ 已定：去掉 SITE_KEY，文件令牌用会话密钥派生。
3. push 的冲突策略：整包覆盖 / 增量对比 / 先拉再推。
4. 现有线上的三个项目如何并成一个画布（或清空重来）。

## 9. 实施阶段

1. ✅ **仓库收拢**：根目录即包，删 `pnpm-workspace.yaml` / `packages/` / `apps/`。
2. ✅ **删本地服务**：`server/` 整块移除，CLI 改成 `push` / `open` / `skill install`。
3. ✅ **单画布 Worker + 只读 SPA**：接口收成 `/api/state`、`/api/file(s)`、`/f/<令牌>/<rel>`。
4. ✅ **Google 登录 + CLI 授权**：`/auth/google`、`/cli/authorize`、`/api/cli/token`；`artifact login`。
5. ⏳ **迁移**：线上 R2 仍是旧结构 `<项目>/…`，需要重新 push 一份 `.artifact`（或写搬运脚本）。

验证：`pnpm typecheck && pnpm test && pnpm build`；测试收敛为核心单测（协议、deep-link、CLI 安装、Worker API/鉴权/路径）。
