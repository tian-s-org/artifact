/**
 * 前端唯一后端入口。全部走相对路径：开发由 Vite 反代到 4331，生产是同一个进程。
 */
import type { CanvasDoc } from '@shared/canvas-schema'

export interface ProjectSummary {
  id: string
  name: string
  boardCount: number
  mtime: number
}

export interface BoardMeta {
  id: string
  mtime: number
  exists: boolean
}

export interface ProjectPayload {
  canvas: CanvasDoc
  boards: BoardMeta[]
  canvasMtime: number
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
    })
  } catch (err) {
    throw new ApiError(0, 'network', `连接不上本地服务：${(err as Error).message}`)
  }
  const text = await res.text()
  const data = text ? (JSON.parse(text) as unknown) : {}
  if (!res.ok) {
    const error = (data as { error?: { code?: string; message?: string } }).error
    throw new ApiError(res.status, error?.code ?? 'http', error?.message ?? `请求失败（${res.status}）`)
  }
  return data as T
}

export function fetchProjects(): Promise<{ projects: ProjectSummary[] }> {
  return request('/api/projects')
}

export function fetchProject(projectId: string): Promise<ProjectPayload> {
  return request(`/api/projects/${encodeURIComponent(projectId)}`)
}

export function createProject(id: string, name: string): Promise<{ canvas: CanvasDoc }> {
  return request('/api/projects', { method: 'POST', body: JSON.stringify({ id, name }) })
}

export function addBoard(
  projectId: string,
  board: { id: string; name: string; width?: number; height?: number },
): Promise<{ board: unknown }> {
  return request(`/api/projects/${encodeURIComponent(projectId)}/boards`, {
    method: 'POST',
    body: JSON.stringify(board),
  })
}

export function moveBoard(projectId: string, boardId: string, x: number, y: number): Promise<unknown> {
  return request(`/api/projects/${encodeURIComponent(projectId)}/boards/${encodeURIComponent(boardId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ x, y }),
  })
}

/** 画板文件地址：带 ?v=<mtime>，内容不变就不重载 iframe */
export function boardSrc(projectId: string, file: string, mtime: number): string {
  const version = mtime > 0 ? `?v=${Math.round(mtime)}` : ''
  return `/files/${encodeURIComponent(projectId)}/${file}${version}`
}

export interface VersionSummary {
  id: string
  /** ISO 时间 */
  at: string
  note: string
  auto?: boolean
  boards: Record<string, { hash: string; file: string }>
}

export interface RestoreResult {
  version: VersionSummary
  backupId: string
  restored: string[]
}

export function fetchVersions(projectId: string): Promise<{ versions: VersionSummary[] }> {
  return request(`/api/projects/${encodeURIComponent(projectId)}/versions`)
}

export function saveVersion(projectId: string, note: string): Promise<{ version: VersionSummary }> {
  return request(`/api/projects/${encodeURIComponent(projectId)}/versions`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  })
}

export function restoreVersion(projectId: string, versionId: string, boardId?: string): Promise<RestoreResult> {
  return request(
    `/api/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}/restore`,
    { method: 'POST', body: JSON.stringify(boardId ? { boardId } : {}) },
  )
}

export interface ProjectEventHandlers {
  onBoardChanged?: (boardId: string, mtime: number) => void
  onBoardAdded?: (boardId: string) => void
  onBoardRemoved?: (boardId: string) => void
  onCanvasChanged?: () => void
  onVersionSaved?: (versionId: string) => void
  onError?: (code: string, message: string) => void
  onConnection?: (state: 'open' | 'closed') => void
}

/** 订阅某个项目的 SSE。返回取消函数。 */
export function subscribeProject(projectId: string, handlers: ProjectEventHandlers): () => void {
  const source = new EventSource(`/events?project=${encodeURIComponent(projectId)}`)
  const parse = <T,>(e: MessageEvent): T | null => {
    try {
      return JSON.parse(e.data) as T
    } catch {
      return null
    }
  }

  const onBoardChanged = (e: MessageEvent) => {
    const data = parse<{ boardId: string; mtime: number }>(e)
    if (data) handlers.onBoardChanged?.(data.boardId, data.mtime)
  }
  const onBoardAdded = (e: MessageEvent) => {
    const data = parse<{ boardId: string }>(e)
    if (data) handlers.onBoardAdded?.(data.boardId)
  }
  const onBoardRemoved = (e: MessageEvent) => {
    const data = parse<{ boardId: string }>(e)
    if (data) handlers.onBoardRemoved?.(data.boardId)
  }
  const onCanvasChanged = () => handlers.onCanvasChanged?.()
  const onVersionSaved = (e: MessageEvent) => {
    const data = parse<{ versionId: string }>(e)
    handlers.onVersionSaved?.(data?.versionId ?? '')
  }
  const onProjectError = (e: MessageEvent) => {
    const data = parse<{ code: string; message: string }>(e)
    if (data) handlers.onError?.(data.code, data.message)
  }

  source.addEventListener('board:changed', onBoardChanged)
  source.addEventListener('board:added', onBoardAdded)
  source.addEventListener('board:removed', onBoardRemoved)
  source.addEventListener('canvas:changed', onCanvasChanged)
  source.addEventListener('version:saved', onVersionSaved)
  source.addEventListener('project:error', onProjectError)
  source.addEventListener('open', () => handlers.onConnection?.('open'))
  source.addEventListener('error', () => handlers.onConnection?.('closed'))

  return () => source.close()
}
