/**
 * 一份画布的小状态机：layout.json + 每块画板 mtime + 文件源基地址。
 *
 * 云端只有一个部署一个画布，靠每 2.5 秒轮询 /api/state 拿最新快照；
 * 高频的视口变化在 canvas-core 里直接写 DOM，不进 React。
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { CanvasDoc } from '@tian-s-org/schema'
import { ApiError, boardSrc, fetchState, type BoardMeta } from '../api/client'
import type { BoardView } from '../canvas/types'

export interface ProjectState {
  status: 'loading' | 'ready' | 'error'
  layout: CanvasDoc | null
  meta: Record<string, BoardMeta>
  error: { code: string; message: string } | null
  /** 最近一次轮询是否成功 */
  connected: boolean
  filesBase: string
}

const INITIAL: ProjectState = {
  status: 'loading',
  layout: null,
  meta: {},
  error: null,
  connected: false,
  filesBase: '',
}

/** 云端没有长连接：每 2.5 秒拉一次快照 */
const POLL_MS = 2500

export class ProjectStore {
  private state: ProjectState = INITIAL
  private listeners = new Set<() => void>()
  private timer: number | null = null
  private stopped = false

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
    this.timer = window.setInterval(() => void this.load({ quiet: true }), POLL_MS)
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
  }

  async load(options: { quiet?: boolean } = {}): Promise<void> {
    if (!options.quiet) this.set({ status: this.state.layout ? 'ready' : 'loading' })
    try {
      const payload = await fetchState()
      if (this.stopped) return
      const meta: Record<string, BoardMeta> = {}
      for (const board of payload.boards) meta[board.id] = board
      this.set({
        status: 'ready',
        layout: payload.layout,
        meta,
        filesBase: payload.filesBase,
        error: null,
        connected: true,
      })
    } catch (err) {
      if (this.stopped) return
      const apiErr = err instanceof ApiError ? err : new ApiError(0, 'unknown', (err as Error).message)
      // 已有好数据时不清空界面，只在底部挂一条提示
      this.set({
        status: this.state.layout ? 'ready' : 'error',
        error: { code: apiErr.code, message: apiErr.message },
        connected: false,
      })
    }
  }
}

/** layout.json + mtime → 画板视图 */
export function boardsToViews(
  layout: CanvasDoc | null,
  meta: Record<string, BoardMeta>,
  filesBase: string,
): BoardView[] {
  if (!layout) return []
  return [...layout.boards]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((board) => ({
      id: board.id,
      name: board.name,
      x: board.x,
      y: board.y,
      width: board.width,
      height: board.height,
      src: boardSrc(board.file, meta[board.id]?.mtime ?? 0, filesBase),
      missing: meta[board.id]?.exists === false,
    }))
}

export function useProject(): { store: ProjectStore; state: ProjectState } {
  const store = useMemo(() => new ProjectStore(), [])
  useEffect(() => {
    store.start()
    return () => store.stop()
  }, [store])
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return { store, state }
}
