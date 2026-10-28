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
  /**
   * 画板文件所在的基地址。本地是 `/files/<项目 id>`；
   * 云端由服务端给出独立沙箱源上的地址（带项目令牌），相对路径照样能拼。
   */
  filesBase?: string
  /** 版本索引的时间戳；轮询模式下靠它发现新版本 */
  versionsMtime?: number
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
  // 用 POST 不用 PATCH：Cloudflare 在边缘就会把 PATCH 挡掉，云端同一个前端要能跑
  return request(`/api/projects/${encodeURIComponent(projectId)}/boards/${encodeURIComponent(boardId)}`, {
    method: 'POST',
    body: JSON.stringify({ x, y }),
  })
}

/** 画板文件地址：带 ?v=<mtime>，内容不变就不重载 iframe */
export function boardSrc(file: string, mtime: number, filesBase: string): string {
  const version = mtime > 0 ? `?v=${Math.round(mtime)}` : ''
  return `${filesBase}/${file}${version}`
}

/** 本地默认的文件基地址；云端由 `/api/projects/:pid` 的 filesBase 覆盖 */
export function defaultFilesBase(projectId: string): string {
  return `/files/${encodeURIComponent(projectId)}`
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

/** 连不上 SSE 时的兜底间隔（云端走轮询） */
const POLL_MS = 2500
/** 给 SSE 的开场时间：这么久还没连上就认为这条通道不可用 */
const SSE_GRACE_MS = 3000

let cloudMode: Promise<boolean> | null = null

/** 这一份前端跑在云端没有：云端没有长连接，直接走轮询 */
function isCloudMode(): Promise<boolean> {
  if (cloudMode === null) {
    cloudMode = fetch('/api/meta')
      .then((res) => (res.ok ? (res.json() as Promise<{ cloud?: boolean }>) : { cloud: false }))
      .then((config) => config.cloud === true)
      .catch(() => false)
  }
  return cloudMode
}

/**
 * 订阅项目的变更。返回取消函数。
 *
 * 首选 SSE（本地服务能立刻推）；连接迟迟打不开就退回轮询——
 * 云端是 Worker，没有长连接，前端靠每 2.5 秒拉一次项目快照来 diff 出同样的事件。
 */
export function subscribeProject(projectId: string, handlers: ProjectEventHandlers): () => void {
  let stopped = false
  let source: EventSource | null = null
  let pollTimer: number | null = null
  let graceTimer: number | null = null
  let opened = false
  let prev: { meta: Record<string, BoardMeta>; canvasMtime: number; versionsMtime: number } | null = null

  const stopSse = (): void => {
    source?.close()
    source = null
    if (graceTimer !== null) window.clearTimeout(graceTimer)
    graceTimer = null
  }

  const pollOnce = async (): Promise<void> => {
    if (stopped) return
    try {
      const payload = await fetchProject(projectId)
      if (stopped) return
      handlers.onConnection?.('open')
      const meta: Record<string, BoardMeta> = {}
      for (const board of payload.boards) meta[board.id] = board
      const versionsMtime = payload.versionsMtime ?? 0
      if (prev) {
        for (const [boardId, board] of Object.entries(meta)) {
          const old = prev.meta[boardId]
          if (!old) handlers.onBoardAdded?.(boardId)
          else if (old.mtime !== board.mtime) handlers.onBoardChanged?.(boardId, board.mtime)
        }
        for (const boardId of Object.keys(prev.meta)) {
          if (!meta[boardId]) handlers.onBoardRemoved?.(boardId)
        }
        if (payload.canvasMtime !== prev.canvasMtime) handlers.onCanvasChanged?.()
        if (versionsMtime !== prev.versionsMtime) handlers.onVersionSaved?.('')
      }
      prev = { meta, canvasMtime: payload.canvasMtime, versionsMtime }
    } catch {
      if (!stopped) handlers.onConnection?.('closed')
    }
  }

  const startPolling = (): void => {
    if (stopped || pollTimer !== null) return
    void pollOnce()
    pollTimer = window.setInterval(() => void pollOnce(), POLL_MS)
  }

  const fallBackToPolling = (): void => {
    if (stopped || pollTimer !== null) return
    stopSse()
    startPolling()
  }

  const parse = <T,>(e: MessageEvent): T | null => {
    try {
      return JSON.parse(e.data) as T
    } catch {
      return null
    }
  }

  const startSse = (): void => {
    const es = new EventSource(`/events?project=${encodeURIComponent(projectId)}`)
    source = es

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

    es.addEventListener('board:changed', onBoardChanged)
    es.addEventListener('board:added', onBoardAdded)
    es.addEventListener('board:removed', onBoardRemoved)
    es.addEventListener('canvas:changed', onCanvasChanged)
    es.addEventListener('version:saved', onVersionSaved)
    es.addEventListener('project:error', onProjectError)
    es.addEventListener('open', () => {
      opened = true
      if (graceTimer !== null) window.clearTimeout(graceTimer)
      graceTimer = null
      handlers.onConnection?.('open')
    })
    es.addEventListener('error', () => {
      if (stopped) return
      handlers.onConnection?.('closed')
      if (!opened) fallBackToPolling()
    })

    graceTimer = window.setTimeout(() => {
      if (!opened) fallBackToPolling()
    }, SSE_GRACE_MS)
  }

  // 云端没有 /events：先问 /api/meta，别让 EventSource 先报一次 MIME 错
  void isCloudMode().then((cloud) => {
    if (stopped) return
    if (cloud) startPolling()
    else startSse()
  })

  return () => {
    stopped = true
    stopSse()
    if (pollTimer !== null) window.clearInterval(pollTimer)
    pollTimer = null
  }
}
