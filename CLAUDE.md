# CLAUDE.md

给在这个仓库里工作的 Agent（Claude Code 等）的说明。用户看的是 `README.md`。

## 这个仓库是什么

Agent 原生的无限设计画布。**画布是只读的**：没有编辑按钮、没有属性面板，改设计只能改文件。
你写 `projects/<项目>/artboards/<画板>/index.html`，用户开着的画布会自己换那一块。

`apps/local` 是本地画布（已完成）；`packages/canvas-core` 是画布引擎（本地版与将来的云端版共用，
原型技能也会引用它）。

## 动手前先读

1. `projects/<项目>/context.md`——项目背景、目标用户、约束。
2. `projects/<项目>/design-system/`——颜色、字号、间距的令牌与规则；画板要按它来。
3. 已有的画板：照着现有风格、尺寸和排版节奏做，别另起一套。

## 常用命令

在仓库根目录：

```bash
pnpm dev                                  # 开发：http://127.0.0.1:4330
pnpm build && pnpm start                  # 生产：单进程
pnpm new-board brand "包装刀版线"          # 新建画板骨架（可 --id board-004 --size 1440x900）
pnpm versions save brand "配色定稿"        # 存一版
pnpm versions list brand
pnpm versions restore brand <版本 id> [--board board-001]
pnpm typecheck && pnpm test && pnpm test:e2e
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

## 验证改动

```bash
pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build
```

E2E 会在临时目录里起真实服务与浏览器，不会碰 `projects/`。
改前端时用 `pnpm dev` 自己看一眼，别只看测试绿。
