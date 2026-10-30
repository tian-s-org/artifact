# artifact 架构（v2 · 云端版）

> 状态：2026-10-30 讨论定稿，**代码仍是 v1**（本地 + 云端、多项目、四个包）。
> 本文是实施目标；改动按文末「实施阶段」推进。

## 1. 一句话

Agent 把设计写成静态 HTML 画板，`push` 到云端；浏览器打开一块**只读的无限画布**，看、并排比较、聚焦、全屏。

## 2. 核心模型

```
一个画布 = 一个目录
├── canvas.json                 画框清单（位置、尺寸、名字、文件）
├── artboards/<id>/index.html   设计本体（静态 HTML，无脚本）
├── assets/{images,fonts}/
└── design-system/              可选：共享 CSS 等普通文件（协议不引用它）
```

- **一个部署 = 一个画布**：没有项目列表、没有 `pid`、没有版本。
- **只读**：画布不能编辑，写只发生在 push 与 HTTP 接口。
- **画布无限大**：多个画框靠坐标分区（品牌区、架构区、UI 区……）。
- **文件即真源**：本地目录是工作副本，云端是同一份结构的镜像。

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
- **刷新**：轮询 `/api/state`（canvas.json + 每块画板 mtime），变化才换 iframe。
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
| 新建画框 | 改 `canvas.json` + 建 `artboards/<id>/index.html` |
| 限制 | 单文件 ≤ 8MB、单包 ≤ 200 文件 |

### 4.3 云端运行时

| 需求 | 说明 |
| --- | --- |
| 单画布 | R2 前缀固定（如 `canvas/`），不再有 `<pid>/` |
| 状态接口 | `GET /api/state` → canvas.json + 每块画板 mtime |
| 轮询 | 约 2.5 秒；Workers 不做长连 SSE |
| 二进制 | base64 编码写入 |

### 4.4 安全不变量

1. 画板 iframe 永远 `sandbox=""`，**永不加** `allow-same-origin`。
2. 画板 CSP：`script-src 'none'`、`connect-src 'none'`，只放行文件源与 `data:`。
3. `/files` 只发 `artboards/`、`assets/`、`design-system/`；`canvas.json`、`context.md` 一律 403。
4. 写接口需要 Bearer；app 页面需要 `SITE_KEY` 门禁。
5. 密钥只放 `.dev.vars`（gitignore）或 `wrangler secret`，不进代码、文档、提交。

### 4.5 CLI 与技能

```
artifact push [目录]      # 本地 .artifact → 云端（默认当前目录）
artifact open             # 打开画布链接
artifact skill install    # 装技能
```

技能指导 agent：建 `.artifact/` → 写画板 → `push` → `open`；并说明尺寸开关与只读边界。

## 5. push 的语义

- **push 的是源文件**：HTML / CSS / SVG / 图片 / 字体 / `canvas.json`，目录结构原样。
- **不做构建**：没有打包、没有转译、没有内联。文件源支持多文件，所以不需要像 Claude Artifact 那样把一切塞进一个 HTML。
- **画板不是 React**：画板运行在 `sandbox=""` 里，脚本不执行；React 只存在于画布壳。
- **画布壳才用 React**：Vite 构建成静态产物，由维护者 `wrangler deploy` 到 Cloudflare Assets——这不是 agent 的 push。
- **组件化的正确姿势**：共享 CSS 放 `design-system/`，画板用相对路径引用，而不是引入 JS 框架。

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

1. 写入主路径：本地目录 + push，还是 agent 直接 HTTP 写云端（或两者并存）。
2. `SITE_KEY` 与文件令牌的轮换方式。
3. push 的冲突策略：整包覆盖 / 增量对比 / 先拉再推。
4. 现有线上的三个项目如何并成一个画布（或清空重来）。

## 9. 实施阶段

1. **单画布 Worker + 只读 SPA**：去掉 pid / Hub / 版本 / 拖拽，接口收成 `/api/state`、`/api/file(s)`、`/files/<rel>`。
2. **CLI**：`push` / `open` / `skill install`；删掉本地起服务的命令。
3. **合包**：视口引擎、协议、SPA、Worker、CLI、技能并进 `@tian-s-org/canvas` 一个包。
4. **迁移**：线上三份项目并成一份画布；技能与文档同步。

每步都跑 `typecheck + 单测 + worker 测试 + 浏览器 E2E`，绿了再进下一步。
