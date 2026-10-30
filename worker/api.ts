/**
 * /api/* 路由。一个部署一个画布，接口全部是「相对画布根」的：
 *
 *   GET  /api/meta            门禁开着没有、能不能写
 *   GET  /api/state           layout.json + 每块画板 mtime + filesBase（前端轮询）
 *   GET  /api/tree            文件清单（agent 看云端有什么）
 *   GET  /api/file?path=…     读单个文件
 *   POST /api/file?path=…     写单个文件（删用 &op=delete）
 *   POST /api/files           整包导入（CLI push 走这条）
 *
 * 写操作一律 POST：Cloudflare 在边缘就挡 PUT/PATCH/DELETE。
 */
import { CanvasError, parseCanvas } from '@tian-s-org/schema'
import { filesToken, type Access } from './auth'
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

async function filesBase(request: Request, env: Env): Promise<string> {
  const token = await filesToken(env)
  const url = new URL(request.url)
  // wrangler dev 只绑一个域名：用相对路径走同源兜底；线上必须走独立文件源
  const local = env.DEV === '1' || url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (local) return `/f/${token}`
  return `https://${env.FILES_HOST}/f/${token}`
}

interface FileInput {
  path?: unknown
  content?: unknown
  encoding?: unknown
}

async function writeOne(
  ctx: ApiContext,
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

  await ctx.storage.writeFile(rel, data)
  const version = await ctx.storage.getVersion(rel)
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

    const resource = segments[1]

    if (resource === 'meta' && segments.length === 2) {
      if (method !== 'GET') throw new HttpError(405, 'method', '不支持的方法')
      return json(200, { cloud: true, gated: env.SITE_KEY !== undefined && env.SITE_KEY !== '', canWrite: access.canWrite })
    }

    // 前端每 2.5 秒轮询一次：layout.json + 每块画板的 mtime + 文件源基地址
    if (resource === 'state' && segments.length === 2) {
      if (method !== 'GET') throw new HttpError(405, 'method', '不支持的方法')
      const layoutData = await ctx.storage.readFile(LAYOUT_FILE).catch(() => null)
      const layoutVersion = await ctx.storage.getVersion(LAYOUT_FILE)
      const layout = layoutData ? parseCanvas(JSON.parse(new TextDecoder().decode(layoutData))) : null
      const boards = []
      for (const board of layout?.boards ?? []) {
        const version = await ctx.storage.getVersion(board.file)
        boards.push({ id: board.id, mtime: version?.mtime ?? 0, exists: version !== null })
      }
      return json(200, {
        layout,
        boards,
        layoutMtime: layoutVersion?.mtime ?? 0,
        filesBase: await filesBase(request, env),
      })
    }

    if (resource === 'tree' && segments.length === 2) {
      if (method !== 'GET') throw new HttpError(405, 'method', '不支持的方法')
      const entries = await ctx.storage.listFiles('')
      return json(200, {
        files: entries.map((entry) => ({ path: entry.path, size: entry.size, mtime: entry.mtime })),
      })
    }

    if (resource === 'file' && segments.length === 2) {
      const rel = url.searchParams.get('path') ?? ''
      if (method === 'GET') {
        if (!isWritableFile(rel)) throw new HttpError(400, 'invalid', `读不到这个路径：${rel}`)
        const data = await ctx.storage.readFile(rel).catch(() => null)
        if (!data) throw new HttpError(404, 'not-found', `文件不存在：${rel}`)
        return new Response(data, {
          status: 200,
          headers: { 'content-type': mimeFor(rel), 'cache-control': 'no-store' },
        })
      }
      if (method === 'POST' && url.searchParams.get('op') !== 'delete') {
        requireWrite(access)
        const body = await readJson<FileInput>(request)
        return json(200, await writeOne(ctx, { ...body, path: body.path ?? rel }))
      }
      if (method === 'POST' && url.searchParams.get('op') === 'delete') {
        requireWrite(access)
        if (!isWritableFile(rel)) throw new HttpError(400, 'invalid', `不能删这个路径：${rel}`)
        await ctx.storage.deleteFile(rel)
        return json(200, { ok: true, path: rel })
      }
      throw new HttpError(405, 'method', '不支持的方法')
    }

    // 整包导入：CLI push 走这条；第一次推必须带 layout.json
    if (resource === 'files' && segments.length === 2) {
      if (method !== 'POST') throw new HttpError(405, 'method', '不支持的方法')
      requireWrite(access)
      const body = await readJson<{ files?: unknown }>(request)
      if (!Array.isArray(body.files) || body.files.length === 0) throw new HttpError(400, 'invalid', '缺少 files 数组')
      if (body.files.length > MAX_IMPORT_FILES) throw new HttpError(413, 'too-many', `一次最多 ${MAX_IMPORT_FILES} 个文件`)

      const hasLayout = body.files.some((item) => (item as FileInput | null)?.path === LAYOUT_FILE)
      if (!hasLayout && !(await ctx.storage.exists(LAYOUT_FILE))) {
        throw new HttpError(400, 'invalid', '第一次推送必须包含 layout.json')
      }

      const written = []
      for (const item of body.files) written.push(await writeOne(ctx, item as FileInput))
      return json(200, { files: written })
    }

    throw new HttpError(404, 'not-found', '未知接口')
  } catch (err) {
    return errorResponse(err)
  }
}

function requireWrite(access: Access): void {
  if (!access.canWrite) throw new HttpError(403, 'forbidden', '需要访问密钥才能修改')
}
