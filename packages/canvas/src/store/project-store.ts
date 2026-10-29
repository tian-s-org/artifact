/**
 * 一个项目一份小状态机：canvas.json + 每个画板的 mtime + SSE 连接状态。
 *
 * 用 useSyncExternalStore 而不是状态库：这里只有低频数据变化，
 * 高频的视口变化在 canvas-core 里直接写 DOM，不进 React。
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { CanvasDoc } from '@tian-s-org/schema'
import {
  ApiError,
  boardSrc,
  defaultFilesBase,
  fetchProject,
  moveBoard as patchBoardPosition,
  subscribeProject,
  type BoardMeta,
} from '../api/client'
import type { BoardView } from '../canvas/types'

export interface ProjectState {
  status: 'loading' | 'ready' | 'error'
  canvas: CanvasDoc | null
  meta: Record<string, BoardMeta>
  error: { code: string; message: string } | null
  connected: boolean
  /** 画板文件基地址：本地是 /files/<id>，云端是独立沙箱源上的地址 */
  filesBase: string
  /** 每保存/恢复一次版本就 +1，版本面板据此重新拉列表 */
  versionTick: number
}

const INITIAL: ProjectState = {
  status: 'loading',
  canvas: null,
  meta: {},
  error: null,
  connected: false,
  filesBase: '',
  versionTick: 0,
}

export class ProjectStore {
  readonly projectId: string
  private state: ProjectState = INITIAL
  private listeners = new Set<() => void>()
  private unsubscribeEvents: (() => void) | null = null
  private refreshTimer: number | null = null
  private stopped = false

  constructor(projectId: string) {
    this.projectId = projectId
  }

  getSnapshot = (): ProjectState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private set(patch: Partial<ProjectState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  start(): void {
    this.stopped = false
    void this.load()
    this.unsubscribeEvents = subscribeProject(this.projectId, {
      onBoardChanged: (boardId, mtime) => {
        const meta = this.state.meta[boardId]
        if (meta && meta.mtime === mtime) return
        this.set({ meta: { ...this.state.meta, [boardId]: { id: boardId, mtime, exists: true } } })
      },
      onBoardAdded: () => this.scheduleRefresh(),
      onBoardRemoved: () => this.scheduleRefresh(),
      onCanvasChanged: () => this.scheduleRefresh(),
      onVersionSaved: () => this.set({ versionTick: this.state.versionTick + 1 }),
      onError: (code, message) => this.set({ error: { code, message } }),
      onConnection: (state) => this.set({ connected: state === 'open' }),
    })
  }

  stop(): void {
    this.stopped = true
    this.unsubscribeEvents?.()
    this.unsubscribeEvents = null
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer)
    this.refreshTimer = null
  }

  /** canvas.json 连续变化时合并成一次请求 */
  private scheduleRefresh(): void {
    if (this.stopped) return
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer)
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null
      void this.load({ quiet: true })
    }, 80)
  }

  async load(options: { quiet?: boolean } = {}): Promise<void> {
    if (!options.quiet) this.set({ status: this.state.canvas ? 'ready' : 'loading' })
    try {
      const payload = await fetchProject(this.projectId)
      if (this.stopped) return
      const meta: Record<string, BoardMeta> = {}
      for (const board of payload.boards) meta[board.id] = board
      this.set({
        status: 'ready',
        canvas: payload.canvas,
        meta,
        filesBase: payload.filesBase ?? defaultFilesBase(this.projectId),
        error: null,
      })
    } catch (err) {
      if (this.stopped) return
      const apiErr = err instanceof ApiError ? err : new ApiError(0, 'unknown', (err as Error).message)
      // 已有好数据时不清空界面，只在角上挂一条提示
      this.set({
        status: this.state.canvas ? 'ready' : 'error',
        error: { code: apiErr.code, message: apiErr.message },
      })
    }
  }

  /** 拖拽松手：先乐观更新，再写回磁盘；写失败就重新拉一遍 */
  async moveBoard(boardId: string, x: number, y: number): Promise<void> {
    const canvas = this.state.canvas
    if (!canvas) return
    const boards = canvas.boards.map((b) => (b.id === boardId ? { ...b, x, y } : b))
    this.set({ canvas: { ...canvas, boards } })
    try {
      await patchBoardPosition(this.projectId, boardId, x, y)
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : new ApiError(0, 'unknown', (err as Error).message)
      this.set({ error: { code: apiErr.code, message: `位置没写回去：${apiErr.message}` } })
      void this.load({ quiet: true })
    }
  }
}

/** canvas.json + mtime → 画板视图 */
export function boardsToViews(
  projectId: string,
  canvas: CanvasDoc | null,
  meta: Record<string, BoardMeta>,
  filesBase = '',
): BoardView[] {
  if (!canvas) return []
  const base = filesBase || defaultFilesBase(projectId)
  return [...canvas.boards]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((board) => ({
      id: board.id,
      name: board.name,
      x: board.x,
      y: board.y,
      width: board.width,
      height: board.height,
      src: boardSrc(board.file, meta[board.id]?.mtime ?? 0, base),
      missing: meta[board.id]?.exists === false,
    }))
}

export function useProject(projectId: string): { store: ProjectStore; state: ProjectState } {
  const store = useMemo(() => new ProjectStore(projectId), [projectId])
  useEffect(() => {
    store.start()
    return () => store.stop()
  }, [store])
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return { store, state }
}
