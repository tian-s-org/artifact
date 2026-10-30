/**
 * 三种身份：
 * 1. Google 会话 —— 登录后的签名 Cookie（`session`），页面与写接口靠它。
 * 2. CLI token —— `artifact login` 换来；服务端只存哈希，`artifact push` 用 Bearer。
 * 3. 画板文件令牌 —— 由同一个密钥对固定串做 HMAC，路径里带着，给不透明源的 iframe 用。
 *
 * 没配 Google（本地 dev）时全放开，不需要任何密钥。
 */
import type { Env } from './env'
import type { R2Storage } from './storage'

export const SESSION_COOKIE = 'artifact_session'
export const SHARE_COOKIE = 'artifact_share'
const SHARE_FILE = 'auth/share.json'
const SESSION_DAYS = 30
const CODE_TTL_MS = 10 * 60 * 1000
const TOKEN_PREFIX = 'auth/tokens/'
const CODE_PREFIX = 'auth/codes/'
const DEV_FALLBACK_SECRET = 'artifact-dev-secret'

function hex(bytes: ArrayBuffer): string {
  let out = ''
  for (const byte of new Uint8Array(bytes)) out += byte.toString(16).padStart(2, '0')
  return out
}

function b64url(input: string): string {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function unb64url(input: string): string | null {
  try {
    return atob(input.replace(/-/g, '+').replace(/_/g, '/'))
  } catch {
    return null
  }
}

function signingSecret(env: Env): string {
  return env.SESSION_SECRET || env.GOOGLE_CLIENT_SECRET || DEV_FALLBACK_SECRET
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

async function sha256(input: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)))
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

export function googleEnabled(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
}

/* ---------------- Google 会话 ---------------- */

export interface Session {
  email: string
  name?: string
  picture?: string
  exp: number
}

export async function signSession(session: Session, env: Env): Promise<string> {
  const payload = b64url(JSON.stringify(session))
  return `${payload}.${await hmac(signingSecret(env), payload)}`
}

export async function readSession(request: Request, env: Env): Promise<Session | null> {
  const raw = cookieValue(request, SESSION_COOKIE)
  if (!raw) return null
  const [payload, signature] = raw.split('.')
  if (!payload || !signature) return null
  if ((await hmac(signingSecret(env), payload)) !== signature) return null
  const text = unb64url(payload)
  if (!text) return null
  try {
    const session = JSON.parse(text) as Session
    if (typeof session.email !== 'string' || typeof session.exp !== 'number') return null
    if (session.exp < Date.now()) return null
    if (session.name !== undefined && typeof session.name !== 'string') delete session.name
    if (session.picture !== undefined && typeof session.picture !== 'string') delete session.picture
    return session
  } catch {
    return null
  }
}

export async function sessionCookie(session: Session, env: Env): Promise<string> {
  const value = await signSession(session, env)
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
}

export function sessionExpiry(): number {
  return Date.now() + SESSION_DAYS * 86400 * 1000
}

/** 通用签名串：OAuth state、一次性回调参数都用它 */
export async function signPayload(env: Env, payload: unknown): Promise<string> {
  const value = b64url(JSON.stringify(payload))
  return `${value}.${await hmac(signingSecret(env), value)}`
}

export async function verifyPayload<T>(env: Env, raw: string | null): Promise<T | null> {
  if (!raw) return null
  const [value, signature] = raw.split('.')
  if (!value || !signature) return null
  if ((await hmac(signingSecret(env), value)) !== signature) return null
  const text = unb64url(value)
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

/** 白名单：邮箱列表或整个域名；两个都没配就不放任何人进来 */
export function emailAllowed(email: string, env: Env): boolean {
  const normalized = email.trim().toLowerCase()
  const list = (env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  if (list.includes(normalized)) return true
  const domain = (env.ALLOWED_DOMAIN ?? '').trim().toLowerCase()
  return domain !== '' && normalized.endsWith(`@${domain}`)
}

/* ---------------- CLI 一次性 code 与长期 token ---------------- */

export interface CliCode {
  redirect: string
  email: string
  exp: number
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function createCliCode(storage: R2Storage, redirect: string, email: string): Promise<string> {
  const code = randomHex(16)
  const payload: CliCode = { redirect, email, exp: Date.now() + CODE_TTL_MS }
  await storage.writeFile(`${CODE_PREFIX}${code}`, JSON.stringify(payload))
  return code
}

export async function consumeCliCode(storage: R2Storage, code: string): Promise<CliCode | null> {
  if (!/^[a-f0-9]{32}$/.test(code)) return null
  const key = `${CODE_PREFIX}${code}`
  const raw = await storage.readText(key).catch(() => null)
  if (raw === null) return null
  await storage.deleteFile(key)
  try {
    const payload = JSON.parse(raw) as CliCode
    if (typeof payload.redirect !== 'string' || typeof payload.email !== 'string') return null
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

export async function createCliToken(storage: R2Storage, email: string): Promise<string> {
  const token = randomHex(24)
  await storage.writeFile(
    `${TOKEN_PREFIX}${await sha256(token)}`,
    JSON.stringify({ email, at: new Date().toISOString() }),
  )
  return token
}

/** 校验 CLI token，返回它属于谁 */
export async function verifyCliToken(storage: R2Storage, token: string): Promise<string | null> {
  if (!/^[a-f0-9]{48}$/.test(token)) return null
  const raw = await storage.readText(`${TOKEN_PREFIX}${await sha256(token)}`).catch(() => null)
  if (raw === null) return null
  try {
    const data = JSON.parse(raw) as { email?: unknown }
    return typeof data.email === 'string' && data.email !== '' ? data.email : null
  } catch {
    return null
  }
}

/* ---------------- 随机分享地址 ---------------- */

async function readShareId(storage: R2Storage): Promise<string | null> {
  const raw = await storage.readText(SHARE_FILE).catch(() => null)
  if (raw === null) return null
  try {
    const data = JSON.parse(raw) as { id?: unknown }
    return typeof data.id === 'string' && /^[a-z0-9]{16,32}$/.test(data.id) ? data.id : null
  } catch {
    return null
  }
}

/** 没有就生成一个；id 是随机的，改了就旧链接失效 */
export async function ensureShareId(storage: R2Storage): Promise<string> {
  const existing = await readShareId(storage)
  if (existing) return existing
  const id = randomHex(12)
  await storage.writeFile(SHARE_FILE, JSON.stringify({ id, at: new Date().toISOString() }))
  return id
}

export async function verifyShareId(storage: R2Storage, id: string): Promise<boolean> {
  const current = await readShareId(storage)
  if (!current || current.length !== id.length) return false
  let diff = 0
  for (let i = 0; i < current.length; i += 1) diff |= current.charCodeAt(i) ^ id.charCodeAt(i)
  return diff === 0
}

export function shareCookie(id: string): string {
  return `${SHARE_COOKIE}=${encodeURIComponent(id)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`
}

/* ---------------- 访问判定 ---------------- */

export interface Access {
  allowed: boolean
  /** 能写：登录会话或 CLI token */
  canWrite: boolean
  /** 登录的人，没有就是 null */
  email: string | null
  /** Google 资料，只有会话里有；CLI token 没有 */
  name?: string
  picture?: string
}

export async function checkAccess(request: Request, env: Env, storage: R2Storage): Promise<Access> {
  const session = await readSession(request, env)
  if (session) {
    return { allowed: true, canWrite: true, email: session.email, name: session.name, picture: session.picture }
  }

  // 随机分享链接进来的人：只读
  const share = cookieValue(request, SHARE_COOKIE)
  if (share !== null && (await verifyShareId(storage, share))) {
    return { allowed: true, canWrite: false, email: null }
  }

  // 没配 Google 就是本地开发模式：全放开
  if (!googleEnabled(env)) return { allowed: true, canWrite: true, email: null }

  const token = bearer(request)
  if (token !== null) {
    const email = await verifyCliToken(storage, token)
    if (email !== null) return { allowed: true, canWrite: true, email }
  }

  return { allowed: false, canWrite: false, email: null }
}

/* ---------------- 画板文件令牌 ---------------- */

/** 文件路径里的令牌：按画布算，换密钥就全局失效 */
export async function filesToken(env: Env, canvasId: string): Promise<string> {
  return (await hmac(signingSecret(env), `artifact-files:${canvasId}`)).slice(0, 32)
}

export async function verifyFilesToken(token: string, env: Env, canvasId: string): Promise<boolean> {
  const expected = await filesToken(env, canvasId)
  if (token.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i += 1) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}
