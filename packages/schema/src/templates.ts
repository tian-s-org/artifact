/**
 * 新建项目/画板时的骨架文件。本地版与云端版共用一份，
 * 保证两边 `pnpm new-board` 与云端建板产出完全一样。
 */
import type { BoardSpec } from './canvas-schema'

export const CONTEXT_TEMPLATE = `# 项目背景

用几句话写清楚：这是给谁做的、要解决什么问题、这一轮要看什么。

（这段文字是给 Agent 看的，不显示在画布上。）
`

export const GUIDELINES_TEMPLATE = `# 设计规范

## 色彩

## 字体

## 间距
`

export const TOKENS_TEMPLATE = `{
  "color": {},
  "font": {},
  "space": {}
}
`

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

export function boardSkeleton(board: BoardSpec): string {
  return `<!doctype html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8">
<title>${escapeHtml(board.name)}</title>
<style>
  :root { --ink: #1d1d1f; --ink-2: #6e6e73; --line: rgba(0,0,0,.1); --accent: #007aff; }
  * { box-sizing: border-box; }
  body { margin: 0; height: 100vh; display: grid; place-items: center; background: #fff; color: var(--ink);
         font: 14px/1.6 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; }
  .wrap { text-align: center; }
  h1 { margin: 0 0 6px; font-size: 20px; font-weight: 600; }
  p { margin: 0; color: var(--ink-2); }
</style>
</head>
<body>
  <div class="wrap">
    <h1>${escapeHtml(board.name)}</h1>
    <p>${board.width} × ${board.height}</p>
  </div>
</body>
</html>
`
}
