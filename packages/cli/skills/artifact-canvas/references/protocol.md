# 文件协议

## 目录

```
<项目根>/<项目>/
├── canvas.json               画布元数据（唯一入口）
├── context.md                项目背景，给 agent 读
├── design-system/
│   ├── tokens.json           色彩 / 字体 / 间距
│   └── guidelines.md         使用规则
├── artboards/<画板 id>/index.html
├── assets/{fonts,images}/    画板引用的本地资源
└── versions/                 版本快照（工具维护，别手改）
```

## canvas.json

```json
{
  "protocol": 1,
  "id": "brand",
  "name": "Northstar 品牌",
  "context": "context.md",
  "designSystem": { "tokens": "design-system/tokens.json", "guidelines": "design-system/guidelines.md" },
  "version": { "current": "v1", "savedAt": "2026-10-29T10:00:00Z" },
  "boards": [
    { "id": "board-001", "name": "品牌核心", "x": 0, "y": 0, "width": 1440, "height": 900,
      "file": "artboards/board-001/index.html", "order": 1 }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `protocol` | 固定 `1` |
| `id` | 项目 id，小写字母 / 数字 / 连字符，同时是目录名 |
| `boards[].id` | 画板 id，规则同上，同时是 `artboards/` 下的目录名 |
| `boards[].file` | 必须是 `artboards/<画板 id>/index.html` |
| `x` `y` | 画布坐标，原点左上，单位画布像素 |
| `width` `height` | 画板设计尺寸；画板 HTML 按这个尺寸铺满 |
| `order` | 画布上的排序（不影响位置） |

校验规则：id 合法、坐标是有限数字、宽高为正、`file` 落在 `artboards/` 且以 `/index.html` 结尾、画板 id 不重复。
未知字段原样保留（协议往后加东西不会打坏旧客户端）；JSON 坏了画布停在上一份好数据并提示，不会崩。

## 画板 HTML

- 纯 HTML / CSS / SVG，**无脚本**（`sandbox=""`），不引用外网（CSP 只放行本机与 `data:`）。
- 只读展示；`pointer-events` 在 iframe 上被关掉，交互交给画布本身。
- 引用资源用相对路径：`../../assets/images/logo.svg`、`../../assets/fonts/x.woff2`、`../../design-system/…`。
- 画板之间完全隔离：每块在独立 iframe 里，同名 class 互不影响——但这也意味着**公共样式要在每块画板里各写一份**，或引用 `design-system/` 下的共享 CSS。

## 版本目录

```
versions/index.json           版本清单（新的在前）
versions/blobs/<sha256 前 16> 文件原始字节，同内容只存一份
```

`index.json` 每项：`{ id, at, note, auto?, canvas: {hash,file}, boards: { <画板 id>: {hash,file} } }`。
版本 id 形如 `v20261029-073000`（UTC），同一秒内重复时加 `-2`、`-3`。
恢复前自动存一份 `auto: true` 的「恢复前自动备份」；恢复时内容已一致的文件不重写。
