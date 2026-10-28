/**
 * 监听 projects/ 下的文件变化，聚成事件发给前端。
 *
 * 三条规则：
 * 1. 防抖 200ms——保存一次 HTML 常伴随多次文件事件；
 * 2. 稳定性双查——mtime 离现在太近就再等一轮，避免读到写了一半的 JSON；
 * 3. 忽略临时文件（.tmp-*、.DS_Store、点开头）——原子写的中间态不广播。
 */
import { watch, type FSWatcher } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { CanvasError, parseCanvas, type CanvasDoc } from '../shared/canvas-schema'
import { isId } from '../shared/canvas-schema'
import type { EventProvider } from './storage/types'

const IGNORED_SEGMENTS = new Set(['node_modules', '.git', 'dist', 'dist-server', '.tmp'])

export interface WatcherOptions {
  root: string
  bus: EventProvider
  /** 聚合窗口，默认 200ms */
  debounceMs?: number
  /** 文件 mtime 距现在小于该值就再等一轮，默认 120ms */
  settleMs?: number
}

interface BoardSnapshot {
  ids: Set<string>
}

export class ProjectWatcher {
  private readonly root: string
  private readonly bus: EventProvider
  private readonly debounceMs: number
  private readonly settleMs: number
  private watcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null
  private pending = new Set<string>()
  private snapshots = new Map<string, BoardSnapshot>()

  constructor(options: WatcherOptions) {
    this.root = options.root
    this.bus = options.bus
    this.debounceMs = options.debounceMs ?? 200
    this.settleMs = options.settleMs ?? 120
  }

  start(): void {
    if (this.watcher) return
    try {
      this.watcher = watch(this.root, { recursive: true }, (_event, filename) => {
        if (!filename) return
        this.pending.add(filename)
        this.schedule()
      })
      this.watcher.on('error', (err) => console.error('[watch] 监听出错', err))
    } catch (err) {
      console.error('[watch] 无法监听项目目录', err)
    }
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.watcher?.close()
    this.watcher = null
    this.pending.clear()
  }

  private schedule(delay = this.debounceMs): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, delay)
  }

  private async flush(): Promise<void> {
    const batch = [...this.pending]
    this.pending.clear()
    if (batch.length === 0) return

    const relevant = batch.filter((rel) => this.isRelevant(rel))
    if (relevant.length === 0) return

    // 稳定性双查：还有文件刚被写、可能还在写，就再等一轮
    const tooFresh = await this.hasFreshFile(relevant)
    if (tooFresh) {
      for (const rel of relevant) this.pending.add(rel)
      this.schedule(this.settleMs)
      return
    }

    const touchedProjects = new Map<string, Set<string>>()
    for (const rel of relevant) {
      const [projectId, rest] = splitProject(rel)
      if (!projectId || rest.length === 0) continue
      const set = touchedProjects.get(projectId) ?? new Set<string>()
      set.add(rest.join('/'))
      touchedProjects.set(projectId, set)
    }

    for (const [projectId, rels] of touchedProjects) {
      if (rels.has('canvas.json')) {
        await this.handleCanvas(projectId, await this.mtimeOf(path.join(projectId, 'canvas.json')))
        continue
      }
      for (const rel of rels) {
        const board = boardFromRel(rel)
        if (!board) continue
        const mtime = await this.mtimeOf(path.join(projectId, 'artboards', board, 'index.html'))
        if (mtime > 0) this.bus.publish({ type: 'board:changed', projectId, boardId: board, mtime })
      }
    }
  }

  private isRelevant(rel: string): boolean {
    if (!rel || rel.includes('\0')) return false
    const segments = rel.split(path.sep).join('/').split('/')
    if (segments.some((s) => s === '' || s.startsWith('.') || IGNORED_SEGMENTS.has(s))) return false
    const [projectId] = segments
    if (!projectId || !isId(projectId)) return false
    return true
  }

  private async hasFreshFile(rels: string[]): Promise<boolean> {
    if (this.settleMs <= 0) return false
    const now = Date.now()
    for (const rel of rels) {
      const mtime = await this.mtimeOf(rel)
      if (mtime <= 0) continue
      // 文件系统的 mtime 精度高于 Date.now()，可能比「现在」还晚几微秒，按 0 岁算
      const age = Math.max(0, now - mtime)
      if (age < this.settleMs) return true
    }
    return false
  }

  private async mtimeOf(rel: string): Promise<number> {
    try {
      const stat = await fs.stat(path.join(this.root, rel))
      return stat.mtimeMs
    } catch {
      return 0
    }
  }

  private async handleCanvas(projectId: string, mtime: number): Promise<void> {
    const prev = this.snapshots.get(projectId)
    let doc: CanvasDoc
    try {
      doc = parseCanvas(JSON.parse(await fs.readFile(path.join(this.root, projectId, 'canvas.json'), 'utf8')))
    } catch (err) {
      const code = err instanceof CanvasError ? err.code : 'invalid-json'
      this.snapshots.set(projectId, { ids: new Set() })
      this.bus.publish({ type: 'project:error', projectId, code, message: (err as Error).message })
      return
    }

    const ids = new Set(doc.boards.map((b) => b.id))
    if (prev) {
      for (const id of ids) if (!prev.ids.has(id)) this.bus.publish({ type: 'board:added', projectId, boardId: id })
      for (const id of prev.ids) if (!ids.has(id)) this.bus.publish({ type: 'board:removed', projectId, boardId: id })
    }
    this.snapshots.set(projectId, { ids })
    this.bus.publish({ type: 'canvas:changed', projectId, mtime })
  }

  /** 测试用：直接喂一批变更路径 */
  async flushForTest(paths: string[]): Promise<void> {
    for (const p of paths) this.pending.add(p)
    await this.flush()
  }
}

function splitProject(rel: string): [string | null, string[]] {
  const segments = rel.split(path.sep).join('/').split('/').filter(Boolean)
  const projectId = segments.shift() ?? null
  return [projectId, segments]
}

/** artboards/<boardId>/… → boardId */
function boardFromRel(rel: string): string | null {
  const segments = rel.split('/')
  if (segments[0] !== 'artboards') return null
  const boardId = segments[1]
  return boardId && isId(boardId) ? boardId : null
}
