---
name: artifact-canvas
description: 把品牌、界面、架构图等设计落成静态 HTML 画框，推到云端画布上查看：并排比较、双击聚焦、全屏、悬停看尺寸；画布只读，设计由 agent 直接改文件再 push。Use when 用户说「放到画布上看」「并排比几个方案」「评审界面」「画多屏原型」「改画框」，或需要把设计稿摆出来一起看时。
---

# artifact 画布

画布是**只读**的：没有绘图工具、图层面板、属性面板。**想改设计就改文件，然后 push**。

这份技能是写给你的（agent）：建目录、写画框、push、开页面都由你执行，用户只看画布、给方向。
命令自己跑；需要登录时让用户在浏览器里点一下即可。

## 开工清单

- [ ] 装了吗：`npx --no-install @tian-s-org/canvas --version`
- [ ] 登录了吗：`npx @tian-s-org/canvas login`（首次会打开浏览器，用户用 Google 授权）
- [ ] 建画布目录：没有 `<项目>/.artifact/` 就照 `assets/canvas.json`、`assets/board.html` 抄
- [ ] 写完 push：`npx @tian-s-org/canvas push <项目>/.artifact`（第一次会自动建画布并打印链接）
- [ ] 打开看：`npx @tian-s-org/canvas open --canvas <id>`

## 目录

```
<项目>/.artifact/
├── layout.json                 画框清单（唯一入口）
├── context.md                  可选：给 agent 读的背景
├── AGENTS.md                   可选：写作规范（建议从 assets/AGENTS.md 拷，只留本地）
├── artboards/<画框 id>/
│   ├── index.html              必需：设计本体（静态 HTML/CSS/SVG，无脚本）
│   ├── style.css               可选：这块画框自己的样式
│   └── shot.png                可选：这块画框自己的图片
└── assets/                     可选：跨画框共享
    ├── images/
    ├── fonts/
    └── css/base.css
```

**一块画布 = 一个随机链接**（`https://artifact.tianyw0.xyz/c/<id>`）。一个人可以有多块画布；
画布无限大，靠坐标分区——同一个项目的多屏就多开画框，不要拆成多块画布。
**看也要登录**：链接只决定看哪一块；拿到链接的人得用自己的 Google 账号登录（且在白名单里）才能打开。
改当然更不行——写只认画布所有者。

## 建画布 / 新建画框

- `assets/canvas.json`：最小 `layout.json`，改 `id`、`name`，`boards` 可留空；
- `assets/board.html`：画框骨架（满屏、CSS 变量、无脚本），复制到 `artboards/<id>/index.html` 再改；
- `assets/AGENTS.md`：写作规范的**建议稿**（标签格式、序号、尺寸、摆位）。想给之后在这个目录里干活的
  agent 留说明，就复制成 `<项目>/.artifact/AGENTS.md`——不是必需；它只留在本地，push 不会上传。

新建画框就是往 `boards` 里加一项、再建对应文件：

```json
{ "id": "board-004", "name": "设置", "x": 4800, "y": 0,
  "width": 1440, "height": 900, "file": "artboards/board-004/index.html", "order": 4 }
```

**画布是自由的**：坐标原点在左上、x 向右、y 向下，其余怎么摆你定——没有规定的主流程方向、行数或网格；
只要求别重叠。**间距按亲和性原则**：相关的画框靠近，不相关的拉开，两档差距本身就是分组线，
不用画分隔线；具体留多少自己拿捏，只要两档一眼能看出差别。

## 画框标签与序号

标签由画布渲染，不用画板自己写：**`01 技能库`** —— 两位序号 + 名称，固定 12.5px 屏幕字号（跟着缩放反向缩）。

- 序号按 `layout.json` 里 `order` 排完后的位置；新增画框要插到正确位置；
- 名称 2–6 个字的名词短语，不写尺寸/版本；
- 尺寸放在悬停标签里：`01 技能库 · 1440 × 900`（工具栏「尺寸」开关）；
- 不要用 `Frame 1`、`未命名`、`board-001` 当显示名，`id` 只用于目录和深链；
- 想按模块编号时，名称写成 `2.1 主界面`——**名称自带编号时画布不再补自己的两位序号**，页面上就是 `2.1 主界面`；
  不写编号才显示 `02 主界面`；
- **尺寸按内容定，不要统一**：画布上会同时有界面、规格页、流程图、单张卡片，各自挑最合适的版面；
- 一个画框对应一个真实的东西——界面就用那台设备的屏幕尺寸，别为了排布去迁就；
- 具体尺寸自己拿捏：聚焦时接近 1:1、细节不用再放大就能看清，就对了；
- 只有**同一个界面的多个状态/变体**才保持同尺寸，好并排比；
- **只有「一屏真实界面」的原型才套窗口 chrome**（红绿灯、标题栏）——那是在画一个软件窗口；
  规格页（设计系统 / 色板 / 图标表）、流程图、架构图、单张组件都不套，套上去会让人误以为这是一屏界面。

## push

```bash
npx @tian-s-org/canvas push                 # 默认推当前目录的 .artifact
npx @tian-s-org/canvas push ./designs       # 指到别处
npx @tian-s-org/canvas push --canvas <id>   # 推到已有的某块画布
npx @tian-s-org/canvas list                 # 我有哪些画布（含链接）
```

- **第一次 push 会自动新建一块画布**，把它的随机 id 写进目录里的 `.canvas`，并打印链接；之后都推到这一块；
- 推的是**源文件**：`layout.json`、`context.md`、`artboards/`、`assets/`，目录结构原样；
- 不编译、不打包、不内联；
- 单文件 ≤ 8MB，一次 ≤ 200 个文件；
- 每次 push 覆盖同名文件；云端没有版本，历史交给 git。

## 改画框

编辑 `artboards/<画框>/index.html`（或它旁边的 CSS/图片），然后 `push`。
动手前先读 `<项目>/.artifact/context.md`；如果已有「规范 / 色板」画框，按它来。

页面每 2.5 秒轮询一次云端：push 完稍等就会自己换那一块，不刷新整页、不打断缩放。

## 画框 HTML 的硬约束

- **没有 JavaScript**：iframe 是 `sandbox=""`，脚本不会执行。交互态只用 CSS（`:hover`、`@media`、`details`）。
- **不引用外网**：画框 CSP 只放行文件源与 `data:`，CDN 字体、外链图片都会被拦。
- 资源用相对路径：`../../assets/images/…`、`../../assets/fonts/…`、`../../assets/css/…`。
- **图标要内联**：`sandbox=""` 让画框变成不透明源，跨文件的 `<use href="../../assets/icons.svg#x">` 会被当成跨源引用而不渲染。
  所以 icon sprite（`<svg class="sprite"><symbol id="i-…">…</symbol></svg>`）要放在**每个画板自己的 HTML 里**，
  用 `<svg class="i"><use href="#i-…"/></svg>` 引用；描边走 `currentColor`，尺寸用 class 控，别写死颜色。
- 放大要清楚：矢量 SVG、真文本、1px 边框；不用位图截图，不把整页包在 `transform: scale()` 里。
- 尺寸以 `layout.json` 的 `width`/`height` 为准，HTML 铺满（`body { margin:0; height:100vh }`）。

## 查看器（用户能用的）

- 拖空白平移、滚轮/触控板缩放；工具栏「适应窗口」「100%」；
- 双击画框聚焦，←/→ 切换，F 全屏，Esc 逐级退出；**聚焦后画框里的元素可以直接悬停/点**；
- 画布上默认把指针让给拖拽，按住 **⌥（Alt）** 才进到画框内部——想看 `:hover`、`details` 这些交互态就按住 ⌥；
- 工具栏「尺寸」开关：悬停画框显示蓝色描边 + `名字 · 宽 × 高`（类似 Figma）；
- 深链 `?focus=<画框 id>&scale=<0.2–4>` 直接定位到某块。

## 禁止

- 不做画布内编辑（绘图、图层、属性面板、拖拽布局）——产品边界。
- 不把 `layout.json`、`context.md` 当画框资源引用——文件源对它们返回 403。
- 不在画框里写脚本、引外网。
- **给 agent 主导的产品画原型时，别画「人能直接改文件」的控件**（接受 diff、建 worktree、推送、合并、发评论）。
  人只负责看和说，写操作交给 agent；界面上摆了这些按钮，故事就不成立了——留一行对 agent 说的话即可。

## 细节

- `layout.json` 的字段与校验规则：改字段或数据可疑时读 `references/protocol.md`；
- 登录、CLI token、写接口与文件源：读 `references/cloud.md`。
