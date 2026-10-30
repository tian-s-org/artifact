/**
 * 三种钥匙：
 * 1. 站点钥匙 SITE_KEY —— 人看的页面和 API 都靠它；带 ?k= 进来就落一个 cookie。
 * 2. Agent token —— 与 SITE_KEY 同一把，但走 `Authorization: Bearer`，给 CLI / Agent 用。
 * 3. 画板文件令牌 —— 由 FILES_SECRET 对项目 id 做 HMAC，路径里带着，
 *    所以 iframe 里的相对资源不用 cookie、也不受站点关卡影响。
 */
import type { Env } from './env'

export const ACCESS_COOKIE = 'artifact_key'

function hex(bytes: ArrayBuffer): string {
  let out = ''
  for (const byte of new Uint8Array(bytes)) out += byte.toString(16).padStart(2, '0')
  return out
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(eq + 1).trim())
    } catch {
      return null
    }
  }
  return null
}

function bearer(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1]?.trim() ?? null
}

/** 站点是否设了门禁；没设就是公开的本地开发模式 */
export function gated(env: Env): boolean {
  return typeof env.SITE_KEY === 'string' && env.SITE_KEY !== ''
}

export interface Access {
  allowed: boolean
  /** 这次是通过 ?k= 进来的，需要补一个 cookie */
  keyFromUrl: string | null
  /** 能写：带钥匙的人 */
  canWrite: boolean
}

export function checkAccess(request: Request, url: URL, env: Env): Access {
  if (!gated(env)) return { allowed: true, keyFromUrl: null, canWrite: true }
  const expected = env.SITE_KEY ?? ''

  const fromUrl = url.searchParams.get('k')
  if (fromUrl !== null && fromUrl === expected) {
    return { allowed: true, keyFromUrl: fromUrl, canWrite: true }
  }

  const fromCookie = cookieValue(request, ACCESS_COOKIE)
  if (fromCookie !== null && fromCookie === expected) {
    return { allowed: true, keyFromUrl: null, canWrite: true }
  }

  const fromHeader = bearer(request)
  if (fromHeader !== null && fromHeader === expected) {
    return { allowed: true, keyFromUrl: null, canWrite: true }
  }

  return { allowed: false, keyFromUrl: null, canWrite: false }
}

function filesSecret(env: Env): string {
  return env.FILES_SECRET && env.FILES_SECRET !== '' ? env.FILES_SECRET : (env.SITE_KEY ?? 'artifact-dev-secret')
}

/** 项目文件路径里的令牌：同一个项目稳定，换 FILES_SECRET 就全局失效 */
export async function filesToken(projectId: string, env: Env): Promise<string> {
  return (await hmac(filesSecret(env), `artifact-files:${projectId}`)).slice(0, 32)
}

export async function verifyFilesToken(projectId: string, token: string, env: Env): Promise<boolean> {
  const expected = await filesToken(projectId, env)
  if (token.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i += 1) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}
