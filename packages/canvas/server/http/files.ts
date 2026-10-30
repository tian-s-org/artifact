/**
 * /files/:projectId/* —— 画板 iframe 唯一的资源入口。
 *
 * 只放行 artboards/、assets/ 两个目录和白名单扩展名；
 * layout.json、context.md、versions/ 一律 403，让画板内的代码看不到画布元数据。
 * 画板 iframe 是 sandbox=""（不透明源），所以字体/图片需要 ACAO: *。
 */
import fs from 'node:fs'
import { createReadStream } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { isId } from '@tian-s-org/schema'
import { isServableFile, mimeFor, projectDir, resolveInside } from '../paths'

/**
 * 画板文档的 CSP。画板是 sandbox=""（不透明源），所以：
 * - 字体/图片按 URL 匹配，不能用 'self'——不透明源永远不匹配 'self'，只能用本机地址。
 * - 任何外部主机、任何请求都被挡下，画板里写死的外网图/埋点发不出去。
 * - 我们自己发这层头，所以 frame-ancestors 不写：父页面是 127.0.0.1 上的画布，
 *   而 frame-ancestors 对比的是不透明源，写了反而会把自己嵌死。
 */
const LOCAL_SOURCES = 'http://127.0.0.1:* http://localhost:*'
const BOARD_CSP = [
  "default-src 'none'",
  `img-src ${LOCAL_SOURCES} data: blob:`,
  `font-src ${LOCAL_SOURCES} data:`,
  `media-src ${LOCAL_SOURCES} data:`,
  `style-src 'unsafe-inline' ${LOCAL_SOURCES}`,
  "script-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

export function handleProjectFile(req: IncomingMessage, res: ServerResponse, root: string, url: URL): void {
  const rest = decodeURIComponent(url.pathname.slice('/files/'.length))
  const slash = rest.indexOf('/')
  const projectId = slash === -1 ? rest : rest.slice(0, slash)
  const rel = slash === -1 ? '' : rest.slice(slash + 1)

  const baseHeaders = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, baseHeaders).end()
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, baseHeaders).end()
    return
  }
  if (!isId(projectId) || !isServableFile(rel)) {
    res.writeHead(403, { ...baseHeaders, 'content-type': 'text/plain; charset=utf-8' }).end('forbidden')
    return
  }

  let abs: string
  try {
    abs = resolveInside(projectDir(root, projectId), rel)
  } catch {
    res.writeHead(403, baseHeaders).end()
    return
  }

  fs.stat(abs, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { ...baseHeaders, 'content-type': 'text/plain; charset=utf-8' }).end('not found')
      return
    }
    const type = mimeFor(rel)
    res.writeHead(200, {
      ...baseHeaders,
      'content-type': type,
      'content-length': stat.size,
      ...(type.startsWith('text/html') ? { 'content-security-policy': BOARD_CSP } : {}),
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    const stream = createReadStream(abs)
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  })
}

/** 生产模式下发 dist/ 里的静态文件；路径穿越一律拒绝 */
export function serveStatic(res: ServerResponse, distDir: string, rel: string): boolean {
  let abs: string
  try {
    abs = resolveInside(distDir, path.posix.normalize(rel))
  } catch {
    return false
  }
  let stat
  try {
    stat = fs.statSync(abs)
  } catch {
    return false
  }
  if (!stat.isFile()) return false
  const ext = path.extname(abs).toLowerCase()
  const type =
    ext === '.html' ? 'text/html; charset=utf-8'
    : ext === '.js' ? 'text/javascript; charset=utf-8'
    : ext === '.css' ? 'text/css; charset=utf-8'
    : ext === '.svg' ? 'image/svg+xml'
    : ext === '.png' ? 'image/png'
    : ext === '.json' ? 'application/json; charset=utf-8'
    : ext === '.woff2' ? 'font/woff2'
    : 'application/octet-stream'
  res.writeHead(200, { 'content-type': type, 'content-length': stat.size })
  createReadStream(abs).pipe(res)
  return true
}
