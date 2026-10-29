/**
 * /api/* 路由。前六条与本地版逐条一致（前端同一份代码），
 * 后面几条是云端多出来的：Agent 直接读写项目文件、拉一棵树、整包导入。
 */
import { isId, parseCanvas, CanvasError } from '@tian-s-org/schema'
import { filesToken, type Access } from './auth'
import type { Env } from './env'
import { errorResponse, HttpError, json, readJson } from './http'
import { isWritableFile, mimeFor, projectKey } from './paths'
import { CANVAS_FILE, type CloudProjectRepository } from './repo'
import type { R2Storage } from './storage'
import { VERSIONS_INDEX, type CloudVersionStore } from './versions'

export interface ApiContext {
  repo: CloudProjectRepository
  storage: R2Storage
  versions: CloudVersionStore
}

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

function filesBase(request: Request, env: Env, projectId: string, token: string): string {
  const url = new URL(request.url)
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  const origin = local ? url.origin : `https://${env.FILES_HOST}`
  return `${origin}/f/${projectId}/${token}`
}

interface FileInput {
  path?: unknown
  content?: unknown
  encoding?: unknown
}

async function writeOne(
  ctx: ApiContext,
  projectId: string,
  input: FileInput,
  options: { projectMustExist: boolean },
): Promise<{ path: string; size: number; mtime: number }> {
  const rel = input.path
  if (typeof rel !== 'string' || !isWritableFile(rel)) throw new HttpError(400, 'invalid', `不能写这个路径：${String(rel)}`)
  if (typeof input.content !== 'string') throw new HttpError(400, 'invalid', `缺少 content：${rel}`)
  const data = encodeBody(input.content, input.encoding)
  if (data.byteLength > MAX_FILE_BYTES) throw new HttpError(413, 'too-large', `文件太大（上限 8MB）：${rel}`)

  if (options.projectMustExist && rel !== CANVAS_FILE) {
    if (!(await ctx.storage.exists(projectKey(projectId, CANVAS_FILE)))) {
      throw new HttpError(404, 'not-found', `项目不存在：${projectId}`)
    }
  }
  if (rel === CANVAS_FILE) {
    let doc
    try {
      doc = parseCanvas(JSON.parse(new TextDecoder().decode(data)))
    } catch (err) {
      if (err instanceof CanvasError) throw new HttpError(400, err.code, err.message)
      throw new HttpError(400, 'invalid', 'canvas.json 不是合法 JSON')
    }
    if (doc.id !== projectId) throw new HttpError(400, 'invalid', `canvas.json 的 id（${doc.id}）和项目 id 不一致`)
  }

  await ctx.storage.writeFile(projectKey(projectId, rel), data)
  const version = await ctx.storage.getVersion(projectKey(projectId, rel))
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

    // 前端启动时读一次：门禁开着没有、能不能写。
    // 叫 meta 不叫 config：Cloudflare 的 WAF 会拦掉路径里带 config 的请求
    if (segments[1] === 'meta' && segments.length === 2) {
      if (method !== 'GET') throw new HttpError(405, 'method', '不支持的方法')
      return json(200, { cloud: true, gated: env.SITE_KEY !== undefined && env.SITE_KEY !== '', canWrite: access.canWrite })
    }

    if (segments[1] !== 'projects') throw new HttpError(404, 'not-found', '未知资源')

    // /api/projects
    if (segments.length === 2) {
      if (method === 'GET') return json(200, { projects: await ctx.repo.listProjects() })
      if (method === 'POST') {
        requireWrite(access)
        const body = await readJson<Record<string, unknown>>(request)
        const id = body.id
        const name = body.name
        if (!isId(id)) throw new HttpError(400, 'invalid', '项目 id 只能是小写字母、数字和连字符')
        if (typeof name !== 'string' || name.trim() === '') throw new HttpError(400, 'invalid', '项目名称不能为空')
        const doc = await ctx.repo.createProject({ id, name: name.trim() })
        return json(201, { canvas: doc })
      }
      throw new HttpError(405, 'method', '不支持的方法')
    }

    const projectId = segments[2]
    if (!projectId || !isId(projectId)) throw new HttpError(400, 'invalid', '项目 id 不合法')

    // /api/projects/:pid
    if (segments.length === 3) {
      if (method !== 'GET') throw new HttpError(405, 'method', '不支持的方法')
      const canvas = await ctx.repo.getProject(projectId)
      const boards = []
      for (const board of canvas.boards) {
        const version = await ctx.storage.getVersion(projectKey(projectId, board.file))
        boards.push({ id: board.id, mtime: version?.mtime ?? 0, exists: version !== null })
      }
      const canvasVersion = await ctx.storage.getVersion(projectKey(projectId, CANVAS_FILE))
      const versionsVersion = await ctx.storage.getVersion(projectKey(projectId, VERSIONS_INDEX))
      const token = await filesToken(projectId, env)
      return json(200, {
        canvas,
        boards,
        canvasMtime: canvasVersion?.mtime ?? 0,
        versionsMtime: versionsVersion?.mtime ?? 0,
        filesBase: filesBase(request, env, projectId, token),
      })
    }

    // /api/projects/:pid/boards
    if (segments.length === 4 && segments[3] === 'boards') {
      if (method !== 'POST') throw new HttpError(405, 'method', '不支持的方法')
      requireWrite(access)
      const body = await readJson<Record<string, unknown>>(request)
      const boardId = body.id
      const name = body.name
      if (!isId(boardId)) throw new HttpError(400, 'invalid', '画板 id 只能是小写字母、数字和连字符')
      if (typeof name !== 'string' || name.trim() === '') throw new HttpError(400, 'invalid', '画板名称不能为空')
      const board = await ctx.repo.addBoard(projectId, {
        id: boardId,
        name: name.trim(),
        width: typeof body.width === 'number' ? body.width : undefined,
        height: typeof body.height === 'number' ? body.height : undefined,
      })
      return json(201, { board })
    }

    // /api/projects/:pid/boards/:bid
    if (segments.length === 5 && segments[3] === 'boards') {
      const boardId = segments[4] ?? ''
      if (!isId(boardId)) throw new HttpError(400, 'invalid', '画板 id 不合法')
      // POST 与 PATCH 都认：浏览器里前端统一用 POST（Cloudflare 会拦 PATCH）
      if (method !== 'PATCH' && method !== 'POST') throw new HttpError(405, 'method', '不支持的方法')
      requireWrite(access)
      const body = await readJson<Record<string, unknown>>(request)
      const { x, y } = body
      if (typeof x !== 'number' || typeof y !== 'number') throw new HttpError(400, 'invalid', '需要数字 x 与 y')
      const board = await ctx.repo.updateBoardPosition(projectId, boardId, x, y)
      return json(200, { board })
    }

    // /api/projects/:pid/versions
    if (segments.length === 4 && segments[3] === 'versions') {
      if (method === 'GET') return json(200, { versions: await ctx.versions.list(projectId) })
      if (method === 'POST') {
        requireWrite(access)
        const body = await readJson<Record<string, unknown>>(request)
        const note = typeof body.note === 'string' ? body.note : ''
        const version = await ctx.versions.save(projectId, note)
        return json(201, { version })
      }
      throw new HttpError(405, 'method', '不支持的方法')
    }

    // /api/projects/:pid/versions/:vid/restore
    if (segments.length === 6 && segments[3] === 'versions' && segments[5] === 'restore') {
      if (method !== 'POST') throw new HttpError(405, 'method', '不支持的方法')
      requireWrite(access)
      const versionId = segments[4] ?? ''
      const body = await readJson<Record<string, unknown>>(request)
      const boardId = typeof body.boardId === 'string' ? body.boardId : undefined
      if (boardId !== undefined && !isId(boardId)) throw new HttpError(400, 'invalid', '画板 id 不合法')
      const result = await ctx.versions.restore(projectId, versionId, boardId ? { boardId } : {})
      return json(200, result)
    }

    // /api/projects/:pid/tree —— Agent 看目录
    if (segments.length === 4 && segments[3] === 'tree') {
      if (method !== 'GET') throw new HttpError(405, 'method', '不支持的方法')
      const prefix = `${projectId}/`
      const entries = await ctx.storage.listFiles(prefix)
      return json(200, {
        files: entries.map((entry) => ({
          path: entry.path.slice(prefix.length),
          size: entry.size,
          mtime: entry.mtime,
        })),
      })
    }

    // /api/projects/:pid/file —— Agent 读/写/删单个文件
    if (segments.length === 4 && segments[3] === 'file') {
      const rel = url.searchParams.get('path') ?? ''
      if (method === 'GET') {
        if (!isWritableFile(rel)) throw new HttpError(400, 'invalid', `读不到这个路径：${rel}`)
        const data = await ctx.storage.readFile(projectKey(projectId, rel)).catch(() => null)
        if (!data) throw new HttpError(404, 'not-found', `文件不存在：${rel}`)
        return new Response(data, {
          status: 200,
          headers: { 'content-type': mimeFor(rel), 'cache-control': 'no-store' },
        })
      }
      // 写用 POST（`op=delete` 表示删）：Cloudflare 在边缘就拦 PUT/PATCH/DELETE，
      // 这两个分支留着是为了让 worker 测试与将来直连的场景也能用
      if (method === 'PUT' || (method === 'POST' && url.searchParams.get('op') !== 'delete')) {
        requireWrite(access)
        const body = await readJson<FileInput>(request)
        const written = await writeOne(ctx, projectId, { ...body, path: body.path ?? rel }, { projectMustExist: true })
        return json(200, written)
      }
      if (method === 'DELETE' || (method === 'POST' && url.searchParams.get('op') === 'delete')) {
        requireWrite(access)
        if (!isWritableFile(rel)) throw new HttpError(400, 'invalid', `不能删这个路径：${rel}`)
        await ctx.storage.deleteFile(projectKey(projectId, rel))
        return json(200, { ok: true, path: rel })
      }
      throw new HttpError(405, 'method', '不支持的方法')
    }

    // /api/projects/:pid/files —— 整包导入（CLI push 走这条）
    if (segments.length === 4 && segments[3] === 'files') {
      if (method !== 'POST') throw new HttpError(405, 'method', '不支持的方法')
      requireWrite(access)
      const body = await readJson<{ files?: unknown; createProject?: unknown; name?: unknown }>(request)
      if (!Array.isArray(body.files) || body.files.length === 0) throw new HttpError(400, 'invalid', '缺少 files 数组')
      if (body.files.length > MAX_IMPORT_FILES) throw new HttpError(413, 'too-many', `一次最多 ${MAX_IMPORT_FILES} 个文件`)

      const exists = await ctx.storage.exists(projectKey(projectId, CANVAS_FILE))
      if (!exists) {
        if (body.createProject !== true) throw new HttpError(404, 'not-found', `项目不存在：${projectId}`)
        const name = typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : projectId
        await ctx.repo.createProject({ id: projectId, name })
      }

      const written = []
      for (const item of body.files) {
        written.push(await writeOne(ctx, projectId, item as FileInput, { projectMustExist: false }))
      }
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
