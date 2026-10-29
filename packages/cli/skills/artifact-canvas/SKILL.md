---
name: artifact-canvas
description: 需要在无限画布上做/看设计时使用——品牌、界面、架构图等落成 HTML 画板，本地画布负责看、并排比较、双击聚焦与版本回退；画布只读，设计由 agent 直接改文件。适用于「放到画布上看」「并排比几个方案」「评审界面」「改画板」这类请求。
---

# artifact 画布

画布是**只读**的：没有绘图工具、图层面板、属性面板。**想改设计就改文件**，开着的画布会自己换那一块，不刷新整页、不打断缩放。

这份技能是写给你的（agent）：**安装、建目录、起画布都由你执行**，用户只看画布、给方向。
命令都自己跑，别把终端步骤甩给用户；需要 token/权限这类只有他能给的东西，再问一次。

## 三个位置

```
<项目>/.artifact/canvas.json                 画板摆在哪、叫什么、多大
<项目>/.artifact/artboards/<画板>/index.html  设计本体
<项目>/.artifact/versions/                   版本快照（内容寻址，别手改）
```

`.artifact/` 自己就是项目，**不要再套一层项目名**。项目根默认是当前目录的 `.artifact/`；
要管多个项目时用 `artifact-cli canvas --projects <目录>` 或 `ARTIFACT_PROJECTS` 指到别的根，那边按 `<根>/<项目 id>/` 组织。

## 建一个项目

当前目录里没有 `.artifact/` 就是还没开始。在**被设计的那个项目**根下建：

```
<项目>/.artifact/
├── canvas.json
├── context.md
├── design-system/{tokens.json,guidelines.md}
└── artboards/<画板 id>/index.html
```

`canvas.json` 最小可用：

```json
{ "protocol": 1, "id": "<项目 id>", "name": "<名字>", "boards": [] }
```

`id` 只受小写字母/数字/连字符约束（它是 URL 里的 `/p/<id>`），不必等于目录名；画板只在 `boards` 里登记后才会出现在画布上。
`context.md` 写项目背景，`design-system/` 写令牌与规则（没有就先摘现有原型的色板和字号）。

## 本地还是云端

- **本地**：项目就是目录，直接改文件（下面各节都是这套）。
- **云端**：项目在 `https://artifact.tianyw0.xyz` 上，文件用 HTTP 接口改，没有本地目录。
  在 artifact 仓库里整包推：`pnpm cloud:push <项目…>`；只改一块画板就走接口（见文末「云端接口」）。

云端画板同样是 `sandbox=""` + 独立文件源，规则和本地一样：无脚本、不引用外网、资源用相对路径。

## 装底座（agent 自己跑，别让用户敲命令）

画布底座是 `@tian-s-org/canvas`（应用壳 + 本地服务），入口是 `@tian-s-org/artifact-cli`，
发布在 GitHub Packages（私有）。装一次即可，**不需要 clone artifact 仓库**。

**先探，别重复装**：

```bash
npx --no-install artifact-cli --version   # 有版本号就是装好了，直接跳到「起画布」
```

**没装才装**（token 优先用本机已登录的 gh；拿不到再问用户要一次，绝不写进项目）：

```bash
npm config set @tian-s-org:registry https://npm.pkg.github.com/
npm config set //npm.pkg.github.com/:_authToken "$(gh auth token)"
npm i -D @tian-s-org/artifact-cli
```

- 装它一个就够，底座与协议包会自动带上。
- 没权限连私有源、或在 artifact 仓库里调试时跳过安装，直接用仓库里的 CLI：
  `npx <artifact 仓库>/packages/cli canvas --repo <artifact 仓库> --projects <目录>`。

## 起画布（后台起，别卡住自己）

**先看在不在跑**，已经在跑就直接用，别重复起、别 kill 别人的进程：

```bash
curl -sf http://127.0.0.1:4330/api/projects >/dev/null && echo already-running
```

没在跑就后台起（用 agent 自己的后台执行能力；Claude Code 里用 run_in_background，不要前台阻塞）：

```bash
npx @tian-s-org/artifact-cli canvas            # 项目根 = 当前目录的 .artifact/
npx @tian-s-org/artifact-cli canvas --projects ./designs --port 4331
```

起来后轮询就绪，再开页面：

```bash
until curl -sf http://127.0.0.1:4330/api/projects >/dev/null; do sleep 0.3; done
open http://127.0.0.1:4330                    # 项目列表；/p/<项目 id> 进画布
```

`?focus=<画板 id>&scale=<0.2–4>` 可直接定位到某块画板，适合把「刚改的那一屏」直接甩给用户看。
端口被占就换一个（`--port 4331`），或者先把已有的实例用起来。

## 新建画板

在 artifact 仓库里：

```bash
pnpm new-board <项目> "<画板名>" [--id board-004] [--size 1440x900]
```

其它项目根就直接写：在 `canvas.json` 的 `boards` 里加一项（`id` 同时是目录名，只能小写字母、数字、连字符），并建 `artboards/<id>/index.html`。

```json
{ "id": "board-004", "name": "方案 C", "x": 4800, "y": 0,
  "width": 1440, "height": 900, "file": "artboards/board-004/index.html", "order": 4 }
```

摆位：原点是左上，x 向右、y 向下，单位是画布像素；同一组方案并排，间隔 160px 以上，别重叠。用户拖动画板会把新坐标写回 `canvas.json`。

## 改画板

直接编辑 `artboards/<画板>/index.html`，存盘即生效，只重载这一块。
动手前先读 `<项目>/context.md` 和 `design-system/`（令牌与规范），新画板照现有画板的视觉语言来。

## 画板 HTML 的硬约束

- **没有 JavaScript**：iframe 是 `sandbox=""`，脚本不会执行。交互态只用 CSS（`:hover`、`@media`、`details` 等）。
- **不引用外网**：画板文档的 CSP 只允许本机地址与 `data:`，CDN 字体、外链图片都会被拦。
- 资源用相对路径：`../../assets/images/…`、`../../assets/fonts/…`、`../../design-system/…`。
- 放大要清楚：矢量 SVG、真文本、1px 边框；不用位图截图，不把整页包在 `transform: scale()` 里。
- 画板尺寸以 `canvas.json` 的 `width`/`height` 为准，HTML 铺满即可（`body { margin:0; height:100vh }`）。

## 版本

大改之前留一版。下面三条是 artifact 仓库里的命令；装成包的项目直接用画布工具栏的「版本」面板：

```bash
pnpm versions save <项目> "<这一版是什么>"
pnpm versions list <项目>
pnpm versions restore <项目> <版本 id> [--board board-001]
```

只有 `--board` 时只写那一块画板，`canvas.json` 与其他画板都不动；恢复前服务端会自动备份当前状态。
画布工具栏的「版本」面板做同样的事。

## 禁止

- 不给画布加编辑能力（绘图、图层、属性面板、画板内编辑）——这是产品边界。
- 不手改 `versions/`（blob 是内容寻址的，改了就对不上）。
- 不把 `canvas.json`、`context.md`、`versions/` 当画板资源引用——`/files` 对它们返回 403。

## 云端接口

密钥用 `Authorization: Bearer <SITE_KEY>`（问用户要，别写进仓库）：

```bash
BASE=https://artifact.tianyw0.xyz/api/projects/<项目>
H="authorization: Bearer $ARTIFACT_KEY"

curl -s "$BASE/tree" -H "$H"                      # 看项目里有什么文件
curl -s "$BASE/file?path=artboards/board-001/index.html" -H "$H"     # 读
curl -s -X POST "$BASE/file" -H "$H" -H 'content-type: application/json' \
  -d '{"path":"artboards/board-001/index.html","content":"<html>…</html>"}'   # 写
```

- **写操作一律 `POST`**（Cloudflare 挡 `PUT`/`PATCH`/`DELETE`）；删文件用 `POST "$BASE/file?path=…&op=delete"`。
- 二进制（图片、字体）用 `{"content":"<base64>","encoding":"base64"}`。
- 新建画板：先 `POST /api/projects/<pid>/boards`，再写它的 `index.html`。
- 写 `canvas.json` 时它的 `id` 必须等于项目 id，否则 400。
- 云端靠轮询（约 2.5 秒）刷新，写完稍等一下再看画布。

协议细节见 `references/protocol.md`。
