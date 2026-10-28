/** /api/* 路由。所有写操作走 ProjectRepository，读操作顺带返回每个画板的 mtime 供前端换 ?v=。 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { isId } from '../../shared/canvas-schema'
import type { FsStorageProvider } from '../storage/fs-storage'
import { CANVAS_FILE } from '../storage/project-repo'
import type { EventProvider, ProjectRepository } from '../storage/types'
import { VERSIONS_INDEX, type FsVersionStore } from '../storage/versions'
import { fail, HttpError, json, readJson, toHttpError } from './respond'

export interface ApiContext {
  repo: ProjectRepository
  storage: FsStorageProvider
  versions: FsVersionStore
  bus: EventProvider
}

interface BoardMeta {
  id: string
  mtime: number
  exists: boolean
}

export async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: ApiContext,
): Promise<void> {
  const segments = url.pathname.split('/').filter(Boolean) // ['api', ...]
  try {
    if (segments[0] !== 'api') throw new HttpError(404, 'not-found', '未知路径')
    const method = req.method ?? 'GET'

    if (segments.length === 1) {
      if (method !== 'GET') throw new HttpError(405, 'method', '不支持的方法')
      json(res, 200, { ok: true })
      return
    }

    // 前端据此判断走 SSE 还是轮询；本地永远是 SSE，也没有门禁。
    // 接口名叫 meta 不叫 config：Cloudflare 的 WAF 会拦掉路径里带 config 的请求
    if (segments[1] === 'meta' && segments.length === 2) {
      if (method !== 'GET') throw new HttpError(405, 'method', '不支持的方法')
      json(res, 200, { cloud: false, gated: false, canWrite: true })
      return
    }

    if (segments[1] !== 'projects') throw new HttpError(404, 'not-found', '未知资源')

    // /api/projects
    if (segments.length === 2) {
      if (method === 'GET') {
        json(res, 200, { projects: await ctx.repo.listProjects() })
        return
      }
      if (method === 'POST') {
        const body = (await readJson(req)) as Record<string, unknown>
        const id = body.id
        const name = body.name
        if (!isId(id)) throw new HttpError(400, 'invalid', '项目 id 只能是小写字母、数字和连字符')
        if (typeof name !== 'string' || name.trim() === '') throw new HttpError(400, 'invalid', '项目名称不能为空')
        const doc = await ctx.repo.createProject({ id, name: name.trim() })
        json(res, 201, { canvas: doc })
        return
      }
      throw new HttpError(405, 'method', '不支持的方法')
    }

    const projectId = segments[2]
    if (!projectId || !isId(projectId)) throw new HttpError(400, 'invalid', '项目 id 不合法')

    // /api/projects/:pid
    if (segments.length === 3) {
      if (method !== 'GET') throw new HttpError(405, 'method', '不支持的方法')
      const canvas = await ctx.repo.getProject(projectId)
      const boards: BoardMeta[] = []
      for (const board of canvas.boards) {
        const version = await ctx.storage.getVersion(path.posix.join(projectId, board.file))
        boards.push({ id: board.id, mtime: version?.mtime ?? 0, exists: version !== null })
      }
      const canvasVersion = await ctx.storage.getVersion(path.posix.join(projectId, CANVAS_FILE))
      const versionsVersion = await ctx.storage.getVersion(path.posix.join(projectId, VERSIONS_INDEX))
      json(res, 200, {
        canvas,
        boards,
        canvasMtime: canvasVersion?.mtime ?? 0,
        versionsMtime: versionsVersion?.mtime ?? 0,
      })
      return
    }

    // /api/projects/:pid/boards
    if (segments.length === 4 && segments[3] === 'boards') {
      if (method !== 'POST') throw new HttpError(405, 'method', '不支持的方法')
      const body = (await readJson(req)) as Record<string, unknown>
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
      json(res, 201, { board })
      return
    }

    // /api/projects/:pid/boards/:bid
    if (segments.length === 5 && segments[3] === 'boards') {
      const boardId = segments[4] ?? ''
      if (!isId(boardId)) throw new HttpError(400, 'invalid', '画板 id 不合法')
      // POST 与 PATCH 等价：Cloudflare 会把 PATCH/PUT/DELETE 直接拦在边缘（403）
      if (method === 'PATCH' || method === 'POST') {
        const body = (await readJson(req)) as Record<string, unknown>
        const { x, y } = body
        if (typeof x !== 'number' || typeof y !== 'number') throw new HttpError(400, 'invalid', '需要数字 x 与 y')
        const board = await ctx.repo.updateBoardPosition(projectId, boardId, x, y)
        json(res, 200, { board })
        return
      }
      throw new HttpError(405, 'method', '不支持的方法')
    }

    // /api/projects/:pid/versions
    if (segments.length === 4 && segments[3] === 'versions') {
      if (method === 'GET') {
        json(res, 200, { versions: await ctx.versions.list(projectId) })
        return
      }
      if (method === 'POST') {
        const body = (await readJson(req)) as Record<string, unknown>
        const note = typeof body.note === 'string' ? body.note : ''
        const version = await ctx.versions.save(projectId, note)
        ctx.bus.publish({ type: 'version:saved', projectId, versionId: version.id })
        json(res, 201, { version })
        return
      }
      throw new HttpError(405, 'method', '不支持的方法')
    }

    // /api/projects/:pid/versions/:vid/restore
    if (segments.length === 6 && segments[3] === 'versions' && segments[5] === 'restore') {
      if (method !== 'POST') throw new HttpError(405, 'method', '不支持的方法')
      const versionId = segments[4] ?? ''
      const body = (await readJson(req)) as Record<string, unknown>
      const boardId = typeof body.boardId === 'string' ? body.boardId : undefined
      if (boardId !== undefined && !isId(boardId)) throw new HttpError(400, 'invalid', '画板 id 不合法')
      const result = await ctx.versions.restore(projectId, versionId, boardId ? { boardId } : {})
      ctx.bus.publish({ type: 'version:saved', projectId, versionId: result.version.id })
      json(res, 200, result)
      return
    }

    throw new HttpError(404, 'not-found', '未知接口')
  } catch (err) {
    const httpErr = toHttpError(err)
    if (httpErr.status >= 500) console.error('[api]', err)
    fail(res, httpErr.status, httpErr.code, httpErr.message)
  }
}
