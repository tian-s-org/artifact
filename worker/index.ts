/**
 * 云端入口。两个域名共用一个 Worker：
 *
 *   artifact.tianyw0.xyz        应用 + /api（有门禁）
 *   artifact-files.tianyw0.xyz  只发 /f/<项目>/<令牌>/...（画板的沙箱源）
 *
 * 前端就是本地版那份 SPA，靠 `/api/projects/:pid` 返回的 filesBase 把画板 iframe
 * 指到文件源上；变更通知走轮询（Workers 上没有长连接）。
 */
import { handleApi } from './api'
import { ACCESS_COOKIE, checkAccess } from './auth'
import type { Env } from './env'
import { handleFile } from './files'
import { fail } from './http'
import { blockedPage } from './page'
import { CloudProjectRepository } from './repo'
import { R2Storage } from './storage'
import { CloudVersionStore } from './versions'

const ONE_YEAR = 60 * 60 * 24 * 365

function withCookie(response: Response, key: string): Response {
  const wrapped = new Response(response.body, response)
  wrapped.headers.append(
    'set-cookie',
    `${ACCESS_COOKIE}=${encodeURIComponent(key)}; Path=/; Max-Age=${ONE_YEAR}; HttpOnly; Secure; SameSite=Lax`,
  )
  wrapped.headers.set('cache-control', 'no-store')
  return wrapped
}

function withSecurityHeaders(response: Response): Response {
  const wrapped = new Response(response.body, response)
  wrapped.headers.set('x-content-type-options', 'nosniff')
  wrapped.headers.set('referrer-policy', 'same-origin')
  return wrapped
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const storage = new R2Storage(env.FILES)

    // 文件源：只认 /f/，别的路径一律 404（这个源上没有页面、没有 API）
    if (url.hostname === env.FILES_HOST) {
      if (url.pathname.startsWith('/f/')) return handleFile(request, url, env, storage)
      return new Response('not found', { status: 404, headers: { 'access-control-allow-origin': '*' } })
    }

    // 同源兜底：没有绑上文件源时（比如 wrangler dev），画板也能从应用源取
    if (url.pathname.startsWith('/f/')) return handleFile(request, url, env, storage)

    const access = checkAccess(request, url, env)
    if (!access.allowed) {
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        return fail(401, 'unauthorized', '需要通过专属链接访问')
      }
      return blockedPage()
    }

    let response: Response
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const ctx = {
        storage,
        repo: new CloudProjectRepository(storage),
        versions: new CloudVersionStore(storage),
      }
      response = await handleApi(request, url, env, ctx, access)
    } else {
      response = withSecurityHeaders(await env.ASSETS.fetch(request))
    }

    return access.keyFromUrl ? withCookie(response, access.keyFromUrl) : response
  },
}
