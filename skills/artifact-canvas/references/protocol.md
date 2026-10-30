# 文件协议

## 目录

```
<项目>/.artifact/             一个目录就是一个画布
├── layout.json               画布元数据（唯一入口）
├── context.md                项目背景，给 agent 读
├── artboards/<画板 id>/index.html   设计本体（可选同目录 CSS/图片）
└── assets/{images,fonts,css}/       可选：跨画板共享的资源
```

共享样式放 `assets/css/`，画板用 `../../assets/css/base.css` 引用。
如果用户要「设计规范」，把它**画成一块画板**，不要写进 `layout.json`。

## layout.json

```json
{
  "protocol": 1,
  "id": "brand",
  "name": "Northstar 品牌",
  "context": "context.md",
  "boards": [
    { "id": "board-001", "name": "品牌核心", "x": 0, "y": 0, "width": 1200, "height": 750,
      "file": "artboards/board-001/index.html", "order": 1 }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `protocol` | 固定 `1` |
| `id` | 画布 id，小写字母 / 数字 / 连字符 |
| `name` | 左上角显示的名字 |
| `context` | 可选；给 agent 读的背景文件，不显示在画布上 |
| `boards[].id` | 画板 id，规则同上，同时是 `artboards/` 下的目录名 |
| `boards[].file` | 必须是 `artboards/<画板 id>/index.html` |
| `x` `y` | 画布坐标，原点左上，单位画布像素 |
| `width` `height` | 画板设计尺寸；画板 HTML 按这个尺寸铺满 |
| `order` | 排序（影响 ←/→ 切换顺序，不改变位置） |

校验规则：id 合法、坐标是有限数字、宽高为正、`file` 落在 `artboards/` 且以 `/index.html` 结尾、画板 id 不重复。
未知字段原样保留（协议往后加东西不会打坏旧客户端）；JSON 坏了画布停在上一份好数据并提示，不会崩。

## 画板 HTML

- 纯 HTML / CSS / SVG，**无脚本**（`sandbox=""`），不引用外网（CSP 只放行文件源与 `data:`）。
- 只读展示；`pointer-events` 在 iframe 上被关掉，交互交给画布本身。
- 引用资源用相对路径：`../../assets/images/logo.svg`、`../../assets/fonts/x.woff2`、`../../assets/css/base.css`。
- 画板之间完全隔离：每块在独立 iframe 里，同名 class 互不影响——公共样式要在每块画板里各写一份，或引用 `assets/css/` 下的共享 CSS。

## 云端

云端与本地目录同构，存储换成 R2：键是 `<相对路径>`，比如 `artboards/board-001/index.html`（一个部署一个画布，没有项目 id 前缀）。

- 画板不从应用源取，而是从独立的文件源 `/f/<令牌>/<相对路径>` 取；令牌由服务端算（HMAC），
  相对资源自动带上同样的前缀，无需改动画板 HTML。
- 画板文档回 `sandbox` CSP、`script-src 'none'`、`connect-src 'none'`，只有 `img/font/style/media`
  允许本项目资源与 `data:`。
- 写文件一律 `POST`：`POST /api/file`（body `{ path, content, encoding? }`）；删用 `?op=delete`；
  整包导入 `POST /api/files`（`{ files[] }`）。
- 变更通知是轮询（约 2.5 秒），不是推送。
- 没有版本机制：文件本身就是版本，交给 git。
