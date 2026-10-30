/**
 * 画布的存储布局（R2）：
 *
 *   canvas/<id>/layout.json          画布内容
 *   canvas/<id>/artboards/…
 *   canvas/<id>/assets/…
 *   canvas/<id>/_meta.json           { id, owner, name, at }
 *   users/<sha256(email)>.json       这个人有哪些画布
 *
 * id 是随机串（24 位十六进制），`/c/<id>` 就是分享链接本身；链接即读权限。
 */
import type { R2Storage } from './storage'

export const META_FILE = '_meta.json'

export interface CanvasMeta {
  id: string
  owner: string
  name: string
  at: string
}

export interface CanvasSummary {
  id: string
  name: string
  at: string
}

export function canvasKey(id: string, rel: string): string {
  return `canvas/${id}/${rel}`
}

export function metaKey(id: string): string {
  return canvasKey(id, META_FILE)
}

function userKey(email: string): Promise<string> {
  return sha256(email.trim().toLowerCase()).then((hash) => `users/${hash}.json`)
}

function sha256(input: string): Promise<string> {
  return crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(input))
    .then((buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join(''))
}

export function newCanvasId(): string {
  const buf = new Uint8Array(12)
  crypto.getRandomValues(buf)
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function isCanvasId(value: string): boolean {
  return /^[a-f0-9]{24}$/.test(value)
}

export async function readMeta(storage: R2Storage, id: string): Promise<CanvasMeta | null> {
  if (!isCanvasId(id)) return null
  const raw = await storage.readText(metaKey(id)).catch(() => null)
  if (raw === null) return null
  try {
    const meta = JSON.parse(raw) as CanvasMeta
    return meta.id === id ? meta : null
  } catch {
    return null
  }
}

export async function listCanvasIds(storage: R2Storage, email: string): Promise<string[]> {
  const raw = await storage.readText(await userKey(email)).catch(() => null)
  if (raw === null) return []
  try {
    const data = JSON.parse(raw) as { canvases?: unknown }
    return Array.isArray(data.canvases) ? data.canvases.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export async function listCanvases(storage: R2Storage, email: string): Promise<CanvasSummary[]> {
  const out: CanvasSummary[] = []
  for (const id of await listCanvasIds(storage, email)) {
    const meta = await readMeta(storage, id)
    if (meta) out.push({ id: meta.id, name: meta.name, at: meta.at })
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))
}

export async function createCanvas(storage: R2Storage, email: string, name: string): Promise<CanvasMeta> {
  const id = newCanvasId()
  const meta: CanvasMeta = { id, owner: email, name: name.trim() || '未命名画布', at: new Date().toISOString() }
  await storage.writeFile(metaKey(id), JSON.stringify(meta))
  const ids = [id, ...(await listCanvasIds(storage, email))]
  await storage.writeFile(await userKey(email), JSON.stringify({ canvases: ids }))
  return meta
}

/** 把画布加进某人的列表（第一次 push 已存在但索引缺失时补上） */
export async function claimCanvas(storage: R2Storage, email: string, id: string): Promise<void> {
  const ids = await listCanvasIds(storage, email)
  if (ids.includes(id)) return
  await storage.writeFile(await userKey(email), JSON.stringify({ canvases: [id, ...ids] }))
}

export async function updateMetaName(storage: R2Storage, id: string, name: string): Promise<void> {
  const meta = await readMeta(storage, id)
  if (!meta) return
  await storage.writeFile(metaKey(id), JSON.stringify({ ...meta, name: name.trim() || meta.name }))
}
