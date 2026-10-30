/**
 * 云端入口。两个域名共用一个 Worker：
 *
 *   artifact.tianyw0.xyz        应用 + /api（Google 登录后可用）
 *   artifact-files.tianyw0.xyz  只发 /f/<令牌>/...（画板的沙箱源）
 *
 * 一个部署一个画布；前端靠 `/api/state` 返回的 filesBase 把画板 iframe 指到文件源上，
 * 变更通知走轮询（Workers 上没有长连接）。
 */
import { handleApi } from './api'
import {
  checkAccess,
  consumeCliCode,
  createCliCode,
  createCliToken,
  emailAllowed,
  googleEnabled,
  sessionCookie,
  sessionExpiry,
  signPayload,
  verifyPayload,
} from './auth'
import type { Env } from './env'
import { handleFile } from './files'
import { errorResponse, fail, json } from './http'
import { authorizePage, blockedPage } from './page'
import { R2Storage } from './storage'

function withSecurityHeaders(response: Response): Response {
  const wrapped = new Response(response.body, response)
  wrapped.headers.set('x-content-type-options', 'nosniff')
  wrapped.headers.set('referrer-policy', 'same-origin')
  return wrapped
}

function redirect(location: string, cookie?: string): Response {
  const headers: Record<string, string> = { location, 'cache-control': 'no-store' }
  if (cookie) headers['set-cookie'] = cookie
  return new Response(null, { status: 302, headers })
}

/** OAuth 回调地址：线上用正式域名；本地 wrangler dev 用 8787 */
function callbackOrigin(env: Env): string {
  return env.DEV === '1' ? 'http://localhost:8787' : `https://${env.APP_HOST}`
}

function loginUrl(request: Request, env: Env): string | null {
  if (!googleEnabled(env)) return null
  const url = new URL(request.url)
  return `/auth/google?redirect=${encodeURIComponent(url.pathname + url.search)}`
}

/** 只允许 CLI 回环地址作为一次性 code 的去向 */
function isLoopbackRedirect(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.hostname === '127.0.0.1' || url.hostname === 'localhost') && (url.protocol === 'http:' || url.protocol === 'https:')
  } catch {
    return false
  }
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

    try {
      // 一次性 code 换 CLI token：code 本身就是凭证，不需要会话
      if (url.pathname === '/api/cli/token' && request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as { code?: unknown }
        const code = typeof body.code === 'string' ? body.code : ''
        const payload = await consumeCliCode(storage, code)
        if (!payload) return fail(401, 'invalid-code', '授权码无效或已过期')
        const token = await createCliToken(storage, 'cli')
        return json(200, { token })
      }

      if (url.pathname === '/auth/google') {
        if (!googleEnabled(env)) return blockedPage(null)
        const redirectTo = url.searchParams.get('redirect') ?? '/'
        const state = await signPayload(env, { redirect: redirectTo, exp: Date.now() + 10 * 60 * 1000 })
        const target = new URL('https://accounts.google.com/o/oauth2/v2/auth')
        target.searchParams.set('client_id', env.GOOGLE_CLIENT_ID ?? '')
        target.searchParams.set('redirect_uri', `${callbackOrigin(env)}/auth/google/callback`)
        target.searchParams.set('response_type', 'code')
        target.searchParams.set('scope', 'openid email profile')
        target.searchParams.set('state', state)
        target.searchParams.set('prompt', 'select_account')
        return redirect(target.toString())
      }

      if (url.pathname === '/auth/google/callback') {
        if (!googleEnabled(env)) return blockedPage(null)
        const state = await verifyPayload<{ redirect: string; exp: number }>(env, url.searchParams.get('state'))
        if (!state || state.exp < Date.now()) return fail(400, 'bad-state', '登录状态已失效，请重试')
        const code = url.searchParams.get('code')
        if (!code) return fail(400, 'no-code', 'Google 没有返回授权码')

        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: env.GOOGLE_CLIENT_ID ?? '',
            client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
            redirect_uri: `${callbackOrigin(env)}/auth/google/callback`,
            grant_type: 'authorization_code',
          }),
        })
        if (!tokenRes.ok) return fail(401, 'google-token', `换 token 失败：${await tokenRes.text()}`)
        const tokens = (await tokenRes.json()) as { access_token?: string }
        if (!tokens.access_token) return fail(401, 'google-token', 'Google 没返回 access_token')

        const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { authorization: `Bearer ${tokens.access_token}` },
        })
        if (!infoRes.ok) return fail(401, 'google-user', '拿不到 Google 用户信息')
        const info = (await infoRes.json()) as { email?: string; email_verified?: boolean }
        const email = info.email ?? ''
        if (!info.email_verified || !emailAllowed(email, env)) {
          return blockedPage(null)
        }

        const cookie = await sessionCookie({ email, exp: sessionExpiry() }, env)
        return redirect(state.redirect.startsWith('/') ? state.redirect : '/', cookie)
      }

      if (url.pathname === '/cli/authorize') {
        const target = url.searchParams.get('redirect') ?? ''
        const cliState = url.searchParams.get('state') ?? ''
        if (!isLoopbackRedirect(target)) return fail(400, 'bad-redirect', '只允许本机回环地址')

        const session = await checkAccess(request, env, storage)
        const current = `/cli/authorize?redirect=${encodeURIComponent(target)}&state=${encodeURIComponent(cliState)}`
        if (!session.allowed || session.email === null) {
          if (!googleEnabled(env)) return blockedPage(null)
          return redirect(`/auth/google?redirect=${encodeURIComponent(current)}`)
        }

        const approve = await signPayload(env, { redirect: target, state: cliState, exp: Date.now() + 10 * 60 * 1000 })
        return authorizePage({
          email: session.email,
          redirect: target,
          approveUrl: `/cli/approve?token=${encodeURIComponent(approve)}`,
        })
      }

      if (url.pathname === '/cli/approve') {
        const payload = await verifyPayload<{ redirect: string; state: string; exp: number }>(
          env,
          url.searchParams.get('token'),
        )
        if (!payload || payload.exp < Date.now()) return fail(400, 'bad-token', '授权已失效')
        if (!isLoopbackRedirect(payload.redirect)) return fail(400, 'bad-redirect', '只允许本机回环地址')
        const session = await checkAccess(request, env, storage)
        if (!session.allowed || session.email === null) return fail(403, 'login', '需要先登录')

        const code = await createCliCode(storage, payload.redirect)
        return redirect(`${payload.redirect}?code=${code}&state=${encodeURIComponent(payload.state)}`)
      }

      const access = await checkAccess(request, env, storage)
      if (!access.allowed) {
        if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
          return fail(401, 'unauthorized', '需要登录')
        }
        return blockedPage(loginUrl(request, env))
      }

      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        return await handleApi(request, url, env, { storage }, access)
      }

      return withSecurityHeaders(await env.ASSETS.fetch(request))
    } catch (err) {
      return errorResponse(err)
    }
  },
}
