/**
 * 云端路径规则。相对键与本地目录完全一致（`artboards/x/index.html`），
 * 只是根从文件系统换成了 R2 桶根 —— 一个部署一个画布，没有项目前缀。
 */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.json': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
}

function extOf(rel: string): string {
  const slash = rel.lastIndexOf('/')
  const dot = rel.lastIndexOf('.')
  return dot > slash ? rel.slice(dot).toLowerCase() : ''
}

export function mimeFor(rel: string): string {
  return MIME[extOf(rel)] ?? 'application/octet-stream'
}

function hasBadSegments(rel: string): boolean {
  if (rel === '' || rel.includes('\\') || rel.includes('\0') || rel.startsWith('/')) return true
  return rel.split('/').some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.'))
}

/** /f 能发的文件：白名单目录 + 白名单扩展名。layout.json、context.md 一律不发 */
const SERVABLE_PREFIXES = ['artboards/', 'assets/'] as const

export function isServableFile(rel: string): boolean {
  if (hasBadSegments(rel)) return false
  if (!SERVABLE_PREFIXES.some((prefix) => rel.startsWith(prefix))) return false
  return mimeFor(rel) !== 'application/octet-stream'
}

/** Agent 能写的文件：白名单目录 + layout.json / context.md */
const WRITABLE_FIXED = new Set(['layout.json', 'context.md'])
const WRITABLE_PREFIXES = ['artboards/', 'assets/'] as const

export function isWritableFile(rel: string): boolean {
  if (hasBadSegments(rel)) return false
  if (WRITABLE_FIXED.has(rel)) return true
  return WRITABLE_PREFIXES.some((prefix) => rel.startsWith(prefix))
}

/** `/f/<token>/artboards/board-001/index.html` 里 token 之后的那段 */
export function relFromPath(pathname: string, prefixSegments: number): string {
  const parts = pathname.split('/').filter(Boolean)
  return parts.slice(prefixSegments).join('/')
}
