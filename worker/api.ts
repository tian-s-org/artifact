/**
 * /api/* 路由。一块画布一个随机 id，路径里带着它：
 *
 *   GET  /api/canvases                 我有哪些画布（要登录）
 *   POST /api/canvases                 新建一块（要登录）{ name }
 *   GET  /api/c/<id>/state             layout.json + 每块画框 mtime + filesBase（链接即读权限）
 *   GET  /api/c/<id>/tree              文件清单
 *   GET  /api/c/<id>/file?path=…       读单个文件
 *   POST /api/c/<id>/file?path=…       写单个文件（删用 &op=delete）——要画布所有者
 *   POST /api/c/<id>/files             整包导入（CLI push 走这条）——要画布所有者
 *
 * 写操作一律 POST：Cloudflare 在边缘就挡 PUT/PATCH/DELETE。
 */
import { CanvasError, parseCanvas } from '@tian-s-org/schema'
import { filesToken, type Access } from './auth'
import { canvasKey, claimCanvas, createCanvas, listCanvases, readMeta, updateMetaName } from './canvases'
import type { Env } from './env'
import { errorResponse, HttpError, json, readJson } from './http'
import { isWritableFile, mimeFor } from './paths'
import type { R2Storage } from './storage'

export interface ApiContext {
  storage: R2Storage
}

export const LAYOUT_FILE = 'layout.json'
const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_IMPORT_FILES = 200

function base64ToBytes(input: string): Uint8Array {
  const bin = atob(input)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

function encodeBody(content: string, encoding: unknown): Uint8Array {
  return encoding === 'base64' ? base64ToBytes(content) : new TextEncoder().encode(content)
}

async function filesBase(request: Request, env: Env, canvasId: string): Promise<string> {
  const token = await filesToken(env, canvasId)
  const url = new URL(request.url)
  const local = env.DEV === '1' || url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  return local ? `/f/${token}/${canvasId}` : `https://${env.FILES_HOST}/f/${token}/${canvasId}`
}

interface FileInput {
  path?: unknown
  content?: unknown
  encoding?: unknown
}

function requireOwner(access: Access, owner: string): void {
  if (access.email === null || access.email !== owner) {
    throw new HttpError(403, 'forbidden', '只有画布所有者能修改')
  }
}

async function writeOne(
  ctx: ApiContext,
  canvasId: string,
  input: FileInput,
): Promise<{ path: string; size: number; mtime: number }> {
  const rel = input.path
  if (typeof rel !== 'string' || !isWritableFile(rel)) {
    throw new HttpError(400, 'invalid', `不能写这个路径：${String(rel)}`)
  }
  if (typeof input.content !== 'string') throw new HttpError(400, 'invalid', `缺少 content：${rel}`)
  const data = encodeBody(input.content, input.encoding)
  if (data.byteLength > MAX_FILE_BYTES) throw new HttpError(413, 'too-large', `文件太大（上限 8MB）：${rel}`)

  if (rel === LAYOUT_FILE) {
    try {
      parseCanvas(JSON.parse(new TextDecoder().decode(data)))
    } catch (err) {
      if (err instanceof CanvasError) throw new HttpError(400, err.code, err.message)
      throw new HttpError(400, 'invalid', 'layout.json 不是合法 JSON')
    }
  }

  await ctx.storage.writeFile(canvasKey(canvasId, rel), data)
  const version = await ctx.storage.getVersion(canvasKey(canvasId, rel))
  return { path: rel, size: data.byteLength, mtime: version?.mtime ?? Date.now() }
}

export async function handleApi(
  request: Request,
  url: URL,
  env: Env,
  ctx: ApiContext,
  access: Access,
): Promise<Response> {
  const segments = url.pathname.split('/').filter(Boolean)
  const method = request.method.toUpperCase()
  try {
    if (segments[0] !== 'api') throw new HttpError(404, 'not-found', '未知路径')

    if (segments.length === 1) {
      if (method !== 'GET') throw new HttpError(405, 'method', '不支持的方法')
      return json(200, { ok: true })
    }

    // 我有哪些画布 / 新建一块
    if (segments[1] === 'canvases' && segments.length === 2) {
      if (access.email === null) throw new HttpError(401, 'unauthorized', '需要登录')
      if (method === 'GET') return json(200, { canvases: await listCanvases(ctx.storage, access.email) })
      if (method === 'POST') {
        const body = await readJson<{ name?: unknown }>(request)
        const name = typeof body.name === 'string' ? body.name : ''
        const meta = await createCanvas(ctx.storage, access.email, name)
        return json(201, { canvas: meta })
      }
      throw new HttpError(405, 'method', '不支持的方法')
    }

    if (segments[1] !== 'c') throw new HttpError(404, 'not-found', '未知资源')
    const canvasId = segments[2] ?? ''
    const meta = await readMeta(ctx.storage, canvasId)
    if (!meta) throw new HttpError(404, 'not-found', '画布不存在或链接已失效')

    const resource = segments[3]

    if (resource === 'state' && segments.length === 4) {
      if (method !== 'GET') throw new HttpError(405, 'method', '不支持的方法')
      const layoutKey = canvasKey(canvasId, LAYOUT_FILE)
      const layoutData = await ctx.storage.readFile(layoutKey).catch(() => null)
      const layoutVersion = await ctx.storage.getVersion(layoutKey)
      const layout = layoutData ? parseCanvas(JSON.parse(new TextDecoder().decode(layoutData))) : null
      const boards = []
      for (const board of layout?.boards ?? []) {
        const version = await ctx.storage.getVersion(canvasKey(canvasId, board.file))
        boards.push({ id: board.id, mtime: version?.mtime ?? 0, exists: version !== null })
      }
      return json(200, {
        layout,
        boards,
        layoutMtime: layoutVersion?.mtime ?? 0,
        filesBase: await filesBase(request, env, canvasId),
        name: meta.name,
      })
    }

    if (resource === 'tree' && segments.length === 4) {
      if (method !== 'GET') throw new HttpError(405, 'method', '不支持的方法')
      const prefix = `canvas/${canvasId}/`
      const entries = await ctx.storage.listFiles(prefix)
      return json(200, {
        files: entries
          .filter((entry) => !entry.path.endsWith('_meta.json'))
          .map((entry) => ({ path: entry.path.slice(prefix.length), size: entry.size, mtime: entry.mtime })),
      })
    }

    if (resource === 'file' && segments.length === 4) {
      const rel = url.searchParams.get('path') ?? ''
      if (method === 'GET') {
        if (!isWritableFile(rel)) throw new HttpError(400, 'invalid', `读不到这个路径：${rel}`)
        const data = await ctx.storage.readFile(canvasKey(canvasId, rel)).catch(() => null)
        if (!data) throw new HttpError(404, 'not-found', `文件不存在：${rel}`)
        return new Response(data, {
          status: 200,
          headers: { 'content-type': mimeFor(rel), 'cache-control': 'no-store' },
        })
      }
      if (method === 'POST' && url.searchParams.get('op') !== 'delete') {
        requireOwner(access, meta.owner)
        const body = await readJson<FileInput>(request)
        const written = await writeOne(ctx, canvasId, { ...body, path: body.path ?? rel })
        if (written.path === LAYOUT_FILE) {
          const raw = await ctx.storage.readText(canvasKey(canvasId, LAYOUT_FILE))
          try {
            await updateMetaName(ctx.storage, canvasId, parseCanvas(JSON.parse(raw)).name)
          } catch {
            // 校验已在 writeOne 里做过
          }
        }
        return json(200, written)
      }
      if (method === 'POST' && url.searchParams.get('op') === 'delete') {
        requireOwner(access, meta.owner)
        if (!isWritableFile(rel)) throw new HttpError(400, 'invalid', `不能删这个路径：${rel}`)
        await ctx.storage.deleteFile(canvasKey(canvasId, rel))
        return json(200, { ok: true, path: rel })
      }
      throw new HttpError(405, 'method', '不支持的方法')
    }

    if (resource === 'files' && segments.length === 4) {
      if (method !== 'POST') throw new HttpError(405, 'method', '不支持的方法')
      requireOwner(access, meta.owner)
      const body = await readJson<{ files?: unknown }>(request)
      if (!Array.isArray(body.files) || body.files.length === 0) throw new HttpError(400, 'invalid', '缺少 files 数组')
      if (body.files.length > MAX_IMPORT_FILES) throw new HttpError(413, 'too-many', `一次最多 ${MAX_IMPORT_FILES} 个文件`)

      const hasLayout = body.files.some((item) => (item as FileInput | null)?.path === LAYOUT_FILE)
      if (!hasLayout && !(await ctx.storage.exists(canvasKey(canvasId, LAYOUT_FILE)))) {
        throw new HttpError(400, 'invalid', '第一次推送必须包含 layout.json')
      }

      const written = []
      for (const item of body.files) written.push(await writeOne(ctx, canvasId, item as FileInput))
      const layout = written.find((file) => file.path === LAYOUT_FILE)
      if (layout) {
        const raw = await ctx.storage.readText(canvasKey(canvasId, LAYOUT_FILE)).catch(() => '')
        try {
          const doc = parseCanvas(JSON.parse(raw))
          await updateMetaName(ctx.storage, canvasId, doc.name)
          await claimCanvas(ctx.storage, meta.owner, canvasId)
        } catch {
          // 校验已在 writeOne 里做过
        }
      }
      return json(200, { files: written })
    }

    throw new HttpError(404, 'not-found', '未知接口')
  } catch (err) {
    return errorResponse(err)
  }
}
