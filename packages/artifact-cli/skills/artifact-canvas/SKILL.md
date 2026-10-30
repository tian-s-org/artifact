---
name: artifact-canvas
description: 把品牌、界面、架构图等设计落成静态 HTML 画板，放在无限画布上查看：并排比较、双击聚焦、全屏、版本回退；画布只读，设计由 agent 直接改文件，存盘即刷新。Use when 用户说「放到画布上看」「并排比几个方案」「评审界面」「画多屏原型」「改画板」，或需要把设计稿摆出来一起看时。
---

# artifact 画布

画布是**只读**的：没有绘图工具、图层面板、属性面板。**想改设计就改文件**，开着的画布会自己换那一块，不刷新整页、不打断缩放。

这份技能是写给你的（agent）：**安装、建目录、起画布都由你执行**，用户只看画布、给方向。
命令都自己跑，别把终端步骤甩给用户；需要 token/权限这类只有他能给的东西，再问一次。

## 开工清单

- [ ] 底座装了吗：`npx --no-install artifact-cli --version`
- [ ] 建项目目录：没有 `<项目>/.artifact/` 就照 `assets/layout.json`、`assets/board.html` 抄
- [ ] 画布在跑吗：`curl -sf http://127.0.0.1:4330/api/projects`
- [ ] 没跑就后台起，轮询就绪后 `open` 页面
- [ ] 画完自检：`node scripts/validate.mjs <项目根>`

## 目录

```
<项目>/.artifact/layout.json                  画板摆在哪、叫什么、多大
<项目>/.artifact/artboards/<画板>/index.html   设计本体
<项目>/.artifact/assets/                      画板引用的图片、字体
```

`.artifact/` 自己就是画布，**不要套项目名，也没有多项目**。`design-system/` 不是协议的一部分：
要给画板共享样式就放 CSS；用户要「设计规范」就画成一块画板。

## 装底座（先探，别重复装）

画布底座是 `@tian-s-org/canvas`，入口是 `@tian-s-org/artifact-cli`，发布在 GitHub Packages（私有）。
装一次即可，**不需要 clone artifact 仓库**。

```bash
npx --no-install artifact-cli --version   # 有版本号就是装好了，跳到「起画布」
```

没装才装（token 优先用本机已登录的 gh；拿不到再问用户要一次，别写进项目）：

```bash
npm config set @tian-s-org:registry https://npm.pkg.github.com/
npm config set //npm.pkg.github.com/:_authToken "$(gh auth token)"
npm i -D @tian-s-org/artifact-cli
```

没权限连私有源、或在 artifact 仓库里调试时跳过安装，用仓库里的 CLI：
`npx <artifact 仓库>/packages/artifact-cli canvas --repo <artifact 仓库> --projects <目录>`。

## 起画布（后台起，别卡住自己）

已经在跑就直接用，别重复起、别 kill 别人的进程：

```bash
curl -sf http://127.0.0.1:4330/api/projects >/dev/null && echo already-running
```

没在跑就后台起（用 agent 自己的后台执行能力，不要前台阻塞）：

```bash
npx @tian-s-org/artifact-cli canvas            # 项目根 = 当前目录的 .artifact/
npx @tian-s-org/artifact-cli canvas --projects ./designs --port 4331
```

就绪后开页面：

```bash
until curl -sf http://127.0.0.1:4330/api/projects >/dev/null; do sleep 0.3; done
open http://127.0.0.1:4330                    # 项目列表；/p/<项目 id> 进画布
```

`?focus=<画板 id>&scale=<0.2–4>` 直接定位到某块画板，适合把刚改的那一屏甩给用户看。
端口被占就换一个（`--port 4331`），或先用已有的实例。

## 建项目 / 新建画板

照模板抄，别自己发明结构：

- `assets/layout.json`：最小 `layout.json`（含一块画板），改 `id`、`name`，`boards` 可以留空。
- `assets/board.html`：画板骨架（满屏、CSS 变量、无脚本），复制到 `artboards/<画板 id>/index.html` 再改内容。

新建画板就在 `boards` 里加一项，再建对应文件：

```json
{ "id": "board-004", "name": "方案 C", "x": 4800, "y": 0,
  "width": 1440, "height": 900, "file": "artboards/board-004/index.html", "order": 4 }
```

`id` 同时是目录名（小写字母、数字、连字符）。摆位：原点左上，x 向右、y 向下，单位画布像素；同组方案并排，间隔 160px 以上，别重叠。
画布只读，位置只由 `layout.json` 决定——挪画板就是改这里的 `x`/`y`。

仓库里调试时可 `pnpm new-board <项目> "<画板名>"`，它自动登记并写骨架。

## 改画板

直接编辑 `artboards/<画板>/index.html`，存盘即生效，只重载这一块。
动手前先读 `<项目>/.artifact/context.md`；如果项目里已有「规范 / 色板」画板，按它来。

已知边界：`assets/` 里文件的变化**不会**触发画板重载，改完让用户刷新页面。

## 画板 HTML 的硬约束

- **没有 JavaScript**：iframe 是 `sandbox=""`，脚本不会执行。交互态只用 CSS（`:hover`、`@media`、`details` 等）。
- **不引用外网**：画板文档的 CSP 只允许本机地址与 `data:`，CDN 字体、外链图片都会被拦。
- 资源用相对路径：`../../assets/images/…`、`../../assets/fonts/…`、`../../design-system/…`。
- 放大要清楚：矢量 SVG、真文本、1px 边框；不用位图截图，不把整页包在 `transform: scale()` 里。
- 尺寸以 `layout.json` 的 `width`/`height` 为准，HTML 铺满（`body { margin:0; height:100vh }`）。

## 版本

大改之前留一版。装成包的项目用画布工具栏的「版本」面板；artifact 仓库里用：

```bash
pnpm versions save <项目> "<这一版是什么>"
pnpm versions list <项目>
pnpm versions restore <项目> <版本 id> [--board board-001]
```

只有 `--board` 时只写那一块画板，`layout.json` 与其他画板都不动；恢复前自动备份当前状态。

## 禁止

- 不给画布加编辑能力（绘图、图层、属性面板、画板内编辑）——这是产品边界。
- 不手改 `versions/`（blob 是内容寻址的，改了就对不上）。
- 不把 `layout.json`、`context.md`、`versions/` 当画板资源引用——`/files` 对它们返回 403。

## 云端

项目挂在 `https://artifact.tianyw0.xyz` 上、没有本地目录时，读写走 HTTP 接口：**读 `references/cloud.md`**
（写操作只能 `POST`，密钥问用户要，别写进仓库）。

## 自检

画完在技能目录里跑，它会校验 `layout.json` 的字段和每块画板的文件：

```bash
node scripts/validate.mjs <项目根>
```

## 细节

`layout.json` 的字段规则、校验错误码、版本目录结构：改字段或数据可疑时读 `references/protocol.md`。
