# artifact

Agent 原生的无限设计画布，本地优先版。

Agent（Claude Code）在项目目录里直接写设计文件，画布只负责看：平移、缩放、并排比较、双击聚焦、版本回退。
没有画图工具、没有图层面板、没有属性面板——想改，就改文件。

```
projects/<项目>/artboards/<画板>/index.html   ← Agent 写这里
projects/<项目>/canvas.json                   ← 画板摆在哪、叫什么、多大
```

改完存盘，正在开着的画布自己换那一块，不刷新整页、不打断缩放。

## 仓库里的三个目标形态

| 形态 | 位置 | 状态 |
| --- | --- | --- |
| 本地画布 | `apps/local` | 已完成（Version A） |
| 云端画布 | `apps/cloud`（未建） | 未开始；本地版已经把存储、项目、事件抽成三个 Provider，换实现即可 |
| `npx` 技能安装 | `packages/cli`（未建） | 未开始；装给本地 Agent 技能库还是云端，取决于上一条 |

`packages/canvas-core` 是前后端无关的画布引擎（视口数学、手势判定、点阵网格、取景），本地版与将来的云端版共用；
原型技能（`skills/prototype`）也会改成引用它，两边画布行为保持一份实现。

## 快速开始

```bash
pnpm install

pnpm dev          # http://127.0.0.1:4330，前端热更新；API 在 4331
pnpm build        # 类型检查 + 打包
pnpm start        # 生产：单进程，http://127.0.0.1:4330
```

环境变量：`ARTIFACT_PORT`（默认 4330）、`ARTIFACT_API_PORT`（开发模式下 API 端口）、
`ARTIFACT_PROJECTS`（项目根目录，默认 `<repo>/projects`）。服务只绑 `127.0.0.1`。

打开首页是项目列表；`/p/<项目 id>` 进画布；`?focus=<画板 id>&scale=<0.2–4>` 直接定位到某块画板。

## 目录

```
artifact/
├── apps/local/                 本地画布应用
│   ├── src/                    画布、聚焦层、项目状态、版本面板
│   ├── server/                 node:http：SPA + /api + /events + /files，文件监听
│   ├── shared/canvas-schema.ts canvas.json 的协议与校验（前后端共用）
│   ├── scripts/                dev、new-board、version、zoom-probe
│   └── tests/{unit,e2e}        node --test；E2E 用 playwright 驱动 Chromium + WebKit
├── packages/canvas-core/src/   viewport / gestures / geometry，无 React 依赖
└── projects/                   示例项目：brand、architecture、web-ui（也就是协议样例）
```

## 文件协议

每个项目一个目录，`canvas.json` 说明这个项目有什么：

```json
{
  "protocol": 1,
  "id": "brand",
  "name": "Northstar 品牌",
  "context": "context.md",
  "designSystem": { "tokens": "design-system/tokens.json", "guidelines": "design-system/guidelines.md" },
  "version": { "current": "v1", "savedAt": "2026-10-29T10:00:00Z" },
  "boards": [
    {
      "id": "board-001",
      "name": "品牌核心",
      "x": 0, "y": 0, "width": 1440, "height": 900,
      "file": "artboards/board-001/index.html",
      "order": 1
    }
  ]
}
```

- `id`、画板 `id`：小写字母、数字、连字符，同时是目录名。
- `file` 必须是 `artboards/<画板 id>/index.html`；不能穿出项目目录。
- 未知字段原样保留，协议往后加东西不会打坏旧客户端；解析失败时画布停在上一份好数据并给出提示。
- 画板内容是纯 HTML/CSS/SVG，不依赖画布实现；画布只负责把文件放进 iframe。

```
projects/<项目>/
├── canvas.json
├── context.md                  项目背景，给 Agent 看的
├── design-system/              tokens.json、guidelines.md（可选，CSS 可以被画板引用）
├── artboards/board-001/index.html
├── assets/{fonts,images}/
└── versions/                   内容寻址的版本快照（见下）
```

## HTTP 接口

```
GET   /                                 项目列表（SPA）
GET   /p/:pid                          画布（SPA）
GET   /api/projects                     项目列表
POST  /api/projects                     { id, name } 建骨架
GET   /api/projects/:pid                canvas.json + 每块画板的 mtime
PATCH /api/projects/:pid/boards/:bid    { x?, y? } 原子写回
POST  /api/projects/:pid/boards         { id, name, width?, height? } 新建画板
GET   /api/projects/:pid/versions       版本列表
POST  /api/projects/:pid/versions       { note } 保存当前状态
POST  /api/projects/:pid/versions/:vid/restore   { boardId? } 整版恢复或只恢复一块画板
GET   /files/:pid/*                     画板静态资源（只放行 artboards/、assets/、design-system/）
GET   /events?project=:pid              SSE
```

SSE 事件：`board:changed`（带 `boardId` 与 `mtime`）、`board:added`、`board:removed`、
`canvas:changed`、`version:saved`、`project:error`。前端看到 `board:changed` 只给那一块 iframe 换 `?v=<mtime>`。

## 版本

内容寻址：`versions/index.json` 记版本清单，文件字节存在 `versions/blobs/<sha256 前 16>`，同内容只存一份。

- 保存：画布工具栏「版本」面板，或 `pnpm versions save brand "配色定稿"`。
- 恢复：整版恢复（画板 + `canvas.json`），或只恢复某一块画板——另一块和 `canvas.json` 都不碰。
- 恢复前自动留一份「恢复前自动备份」（`auto`）。
- 恢复时内容已经一致的文件不重写：mtime 不动，画布不会白白重载那块画板。

## 安全边界

Agent 产出的 HTML 按不可信处理：

- iframe `sandbox=""`（没有脚本、不透明源），父页面读不到画板内部，画板碰不到父页面。
- 画板文档带 CSP：禁脚本、禁外部网络；图片/字体只允许本地服务与 `data:`。
- `/files` 只放行画板资源，`canvas.json`、`context.md`、`versions/` 一律 403。
- 服务只绑 `127.0.0.1`。

## 验证

```bash
pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build && pnpm start
```

- 单测（`tests/unit`）：协议校验、路径防护、仓库读写、文件监听去抖、版本存储。
- E2E（`tests/e2e`）：真实浏览器 + 真实服务 + 临时项目目录——取景/平移/缩放锚定/聚焦/深链、
  拖拽写回磁盘、隔离与安全（同名 class、脚本不执行、外网请求发不出、父页面读不到内部）、
  画板资源（图片真画出来、字体与共享样式表能取到）、版本保存与恢复。
- `pnpm probe:zoom`：Chromium / WebKit 下不同缩放实现的清晰度对比。

## 和原型技能的关系

画布引擎（`packages/canvas-core`）由本仓库拥有，原型技能通过别名引用这一份实现。
技能侧改造还没做（那边有未提交的改动，等它干净了再切）。

## 云端迁移建议

本地版已经把「存储 / 项目 / 事件」抽成三个接口（`apps/local/server/storage/types.ts`），云版只换实现：

| 本地 | 云端 | 注意 |
| --- | --- | --- |
| `StorageProvider`（文件系统） | 对象存储（S3 / R2），键仍是 `projects/<pid>/...` | 原子写换成 PUT 覆盖；`getVersion` 用 ETag 代替 mtime |
| `ProjectRepository` | 同一份 `canvas.json`（存在对象存储里） | 多写者时把「读-改-写」换成带版本号的乐观锁；本地用每项目写队列 |
| `EventProvider`（SSE + fs.watch） | 服务端 WebSocket / SSE，写入方主动发事件 | 事件形态（`board:changed` 等）保持不变，前端不用改 |
| `versions/`（blob + index.json） | 对象存储里同一套内容寻址布局 | blob 天然适合对象存储；索引对象要加条件写 |
| `127.0.0.1` 绑定 | 需要认证与租户隔离 | iframe 的 `sandbox=""` 与画板 CSP 不变，多租户时再加源站校验 |

画板是纯静态 HTML，云端可以直接由 CDN 发；剩下要新写的只有认证、租户与写入鉴权。
