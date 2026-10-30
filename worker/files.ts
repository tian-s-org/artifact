/**
 * /f/<文件令牌>/<相对路径> —— 画板 iframe 的唯一资源入口。
 *
 * 这一路刻意跑在独立源上：没有 cookie、没有 API、不发 layout.json / context.md / versions/。
 * 配合 iframe 的 sandbox="" 和下面这层 CSP，Agent 产出的 HTML 即使带脚本、外链、
 * 发请求的代码，也既碰不到画布页面，也发不出任何请求。
 * 文件令牌在路径里，所以画板里的相对资源（../../assets/x.png）自动带着它。
 */
import type { Env } from './env'
import { verifyFilesToken } from './auth'
import { isServableFile, mimeFor } from './paths'
import type { R2Storage } from './storage'

/** 画板文档的 CSP：除了本文件源上的样式/图片/字体，什么都不许加载，什么请求都不许发 */
function boardCsp(origin: string): string {
  return [
    "default-src 'none'",
    `img-src ${origin} data: blob:`,
    `font-src ${origin} data:`,
    `media-src ${origin} data:`,
    `style-src 'unsafe-inline' ${origin}`,
    "script-src 'none'",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    // 再加一层：文档自己就是沙箱（不透明源），不靠外层 iframe 也站得住
    'sandbox',
  ].join('; ')
}

const BASE_HEADERS: Record<string, string> = {
  // 画板是不透明源，字体/图片按跨源请求走，必须放行
  'access-control-allow-origin': '*',
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'cross-origin',
}

export async function handleFile(
  request: Request,
  url: URL,
  env: Env,
  storage: R2Storage,
): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...BASE_HEADERS, 'access-control-allow-methods': 'GET, HEAD, OPTIONS' },
    })
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('method not allowed', { status: 405, headers: BASE_HEADERS })
  }

  const parts = url.pathname.split('/').filter(Boolean) // ['f', token, ...rel]
  const token = parts[1] ?? ''
  const rel = parts.slice(2).join('/')

  if (!(await verifyFilesToken(token, env)) || !isServableFile(rel)) {
    return new Response('forbidden', { status: 403, headers: BASE_HEADERS })
  }

  const obj = await storage.readFile(rel).catch(() => null)
  if (!obj) return new Response('not found', { status: 404, headers: BASE_HEADERS })

  const type = mimeFor(rel)
  const versioned = url.searchParams.has('v')
  const headers: Record<string, string> = {
    ...BASE_HEADERS,
    'content-type': type,
    // 带 ?v=<mtime> 的地址内容不会变；直接访问的（比如单独打开画板）就不缓存
    'cache-control': versioned ? 'public, max-age=300' : 'no-store',
  }
  if (type.startsWith('text/html')) headers['content-security-policy'] = boardCsp(url.origin)

  if (request.method === 'HEAD') return new Response(null, { status: 200, headers })
  return new Response(obj, { status: 200, headers })
}
