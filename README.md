# artifact

Agent 原生的**只读设计画布**：agent 把设计写成静态 HTML 画框，`artifact push` 到云端，人在浏览器里看——
平移缩放、并排比较、双击聚焦、全屏、悬停看尺寸。没有编辑器，改设计就改文件。

```
<项目>/.artifact/  ──artifact push──▶  Cloudflare Worker + R2  ──▶  浏览器只读画布
```

## 快速开始

```bash
npm i -D @tian-s-org/canvas        # 或 npx @tian-s-org/canvas ...
npx @tian-s-org/canvas login       # 浏览器里用 Google 授权，token 存在本机
npx @tian-s-org/canvas push        # 推当前目录的 .artifact/
npx @tian-s-org/canvas open        # 打开画布
```

## 目录协议

一个画布就是一个目录：

```
.artifact/
├── layout.json                 画框清单
├── context.md                  可选：给 agent 读的背景
├── artboards/<画框 id>/
│   ├── index.html              设计本体（静态 HTML/CSS/SVG，无脚本）
│   ├── style.css               可选：这块画框自己的样式
│   └── shot.png                可选：这块画框自己的图片
└── assets/                     可选：跨画框共享
    ├── images/  fonts/  css/
```

`layout.json`：

```json
{
  "protocol": 1,
  "id": "skillbor",
  "name": "skillbor 原型",
  "context": "context.md",
  "boards": [
    {
      "id": "board-001",
      "name": "技能库",
      "x": 0, "y": 0, "width": 1440, "height": 900,
      "file": "artboards/board-001/index.html",
      "order": 1
    }
  ]
}
```

- 协议只描述画框：`protocol / id / name / context / boards[]`；
- `boards[].file` 必须是 `artboards/<id>/index.html`；
- 坐标原点左上，x 向右、y 向下，单位画布像素；画布无限大，多屏就多开画框。

## 画框 HTML

- **无脚本**：iframe 是 `sandbox=""`，脚本不执行；
- **不引外网**：CSP 只放行文件源与 `data:`；
- 资源用相对路径：`../../assets/images/…`、`../../assets/fonts/…`、`../../assets/css/…`；
- 矢量 SVG + 真文本 + 1px 边框，放大要清楚；
- 尺寸以 `layout.json` 的 `width`/`height` 为准，HTML 铺满。

## 查看器

拖空白平移、滚轮/触控板缩放、适应窗口、100%；双击聚焦、←/→ 切换、F 全屏、Esc 逐级退出；
工具栏「尺寸」开关：悬停画框显示 `名字 · 宽 × 高`；深链 `?focus=<画框 id>&scale=<0.2–4>`。
页面每 2.5 秒轮询一次，只换变化的那一块，不整页刷新。

## 本地开发

```bash
pnpm install
pnpm dev:worker        # wrangler dev（--var DEV:1，文件源走同源 /f/）
```

本地不配 Google 时是「全放开」模式，不需要任何密钥；要测登录就在仓库根 `.dev.vars`（已 gitignore）写：

```
GOOGLE_CLIENT_ID=…
GOOGLE_CLIENT_SECRET=…
ALLOWED_EMAILS=you@example.com        # 或 ALLOWED_DOMAIN=example.com
SESSION_SECRET=…                      # 可选；不写就用 client secret 签名
```

Google OAuth 的回调地址：线上 `https://artifact.tianyw0.xyz/auth/google/callback`，
本地 `http://localhost:8787/auth/google/callback`。

## 部署

```bash
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put ALLOWED_EMAILS      # 或 ALLOWED_DOMAIN
wrangler secret put SESSION_SECRET      # 可选
pnpm deploy                             # vite build + wrangler deploy
```

一块画布一个随机 id；R2 键是 `canvas/<id>/…`（`layout.json`、`artboards/…`、`assets/…`）。
一个人可以有多块：`artifact list` 列出自己的，`/c/<id>` 是分享链接——打开要登录（白名单账号），链接只决定看哪一块。

## 仓库结构

```
artifact/
├── src/          只读画布（React）：core 视口 / protocol / shell / store / api
├── worker/       Cloudflare Worker：/api/state、/api/file(s)、/f/<令牌>/<路径>、Google 登录
├── cli/          artifact login / logout / push / open / skill install
├── skills/       artifact-canvas 技能（随包发布）
├── tests/        unit · cli · worker
└── index.html · vite.config.ts · wrangler.jsonc · tsconfig.json
```

## 安全

1. 画框 iframe 永远 `sandbox=""`，不加 `allow-same-origin`；
2. 画框 CSP：`script-src 'none'`、`connect-src 'none'`，只放行文件源与 `data:`；
3. 文件源只发 `artboards/`、`assets/`；`layout.json`、`context.md` 一律 403；
4. 页面与写接口都要 Google 会话；CLI 用 `artifact login` 换的 token；
5. 密钥只放 `.dev.vars`（gitignore）或 `wrangler secret`，不进代码、文档、提交。
