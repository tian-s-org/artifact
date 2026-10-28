/**
 * ProjectRepository 的文件系统实现。
 *
 * 并发约定：同一个项目的读-改-写一律进项目队列，避免「画布拖拽写回 x/y」和
 * 「Agent 同时改 canvas.json」互相覆盖。写入走原子 rename。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  CanvasError,
  emptyCanvas,
  formatCanvas,
  isId,
  makeBoard,
  nextBoardPosition,
  parseCanvas,
  type BoardSpec,
  type CanvasDoc,
} from '../../shared/canvas-schema'
import { projectDir, resolveInside } from '../paths'
import { withProjectLock } from './locks'
import type { CreateProjectInput, ProjectRepository } from './types'

export const CANVAS_FILE = 'canvas.json'

export class ProjectNotFoundError extends Error {
  readonly code = 'not-found'
  constructor(projectId: string) {
    super(`项目不存在：${projectId}`)
    this.name = 'ProjectNotFoundError'
  }
}

export class ProjectExistsError extends Error {
  readonly code = 'exists'
  constructor(projectId: string) {
    super(`项目已存在：${projectId}`)
    this.name = 'ProjectExistsError'
  }
}

const CONTEXT_TEMPLATE = `# 项目背景

用几句话写清楚：这是给谁做的、要解决什么问题、这一轮要看什么。

（这段文字是给 Agent 看的，不显示在画布上。）
`

const GUIDELINES_TEMPLATE = `# 设计规范

## 色彩

## 字体

## 间距
`

const TOKENS_TEMPLATE = `{
  "color": {},
  "font": {},
  "space": {}
}
`

export function boardSkeleton(board: BoardSpec): string {
  return `<!doctype html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8">
<title>${escapeHtml(board.name)}</title>
<style>
  :root { --ink: #1d1d1f; --ink-2: #6e6e73; --line: rgba(0,0,0,.1); --accent: #007aff; }
  * { box-sizing: border-box; }
  body { margin: 0; height: 100vh; display: grid; place-items: center; background: #fff; color: var(--ink);
         font: 14px/1.6 -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; }
  .wrap { text-align: center; }
  h1 { margin: 0 0 6px; font-size: 20px; font-weight: 600; }
  p { margin: 0; color: var(--ink-2); }
</style>
</head>
<body>
  <div class="wrap">
    <h1>${escapeHtml(board.name)}</h1>
    <p>${board.width} × ${board.height}</p>
  </div>
</body>
</html>
`
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

export class FsProjectRepository implements ProjectRepository {
  private readonly root: string

  constructor(root: string) {
    this.root = root
  }

  /** 同一项目串行，跨项目并行 */
  private withLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    return withProjectLock(projectId, fn)
  }

  private dir(projectId: string): string {
    if (!isId(projectId)) throw new CanvasError('invalid', `项目 id 不合法：${projectId}`)
    return projectDir(this.root, projectId)
  }

  private async readDoc(projectId: string): Promise<CanvasDoc> {
    const dir = this.dir(projectId)
    const file = resolveInside(dir, CANVAS_FILE)
    let text: string
    try {
      text = await fs.readFile(file, 'utf8')
    } catch {
      throw new ProjectNotFoundError(projectId)
    }
    return parseCanvas(JSON.parse(text))
  }

  private async writeDoc(projectId: string, doc: CanvasDoc): Promise<void> {
    const dir = this.dir(projectId)
    const file = resolveInside(dir, CANVAS_FILE)
    const tmp = path.join(path.dirname(file), `${path.basename(file)}.tmp-${process.pid}-${Date.now()}`)
    await fs.writeFile(tmp, formatCanvas(doc))
    await fs.rename(tmp, file)
  }

  async listProjects(): Promise<{ id: string; name: string; boardCount: number; mtime: number }[]> {
    let items
    try {
      items = await fs.readdir(this.root, { withFileTypes: true })
    } catch {
      return []
    }
    const out: { id: string; name: string; boardCount: number; mtime: number }[] = []
    for (const item of items) {
      if (!item.isDirectory() || !isId(item.name)) continue
      const file = path.join(this.root, item.name, CANVAS_FILE)
      try {
        const stat = await fs.stat(file)
        const doc = parseCanvas(JSON.parse(await fs.readFile(file, 'utf8')))
        out.push({ id: doc.id, name: doc.name, boardCount: doc.boards.length, mtime: stat.mtimeMs })
      } catch {
        // 坏项目不进列表；打开它会得到 project:error
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id))
  }

  async createProject(input: CreateProjectInput): Promise<CanvasDoc> {
    const { id, name } = input
    if (!isId(id)) throw new CanvasError('invalid', `项目 id 不合法：${id}`)
    if (typeof name !== 'string' || name.trim() === '') throw new CanvasError('invalid', '项目名称不能为空')
    const dir = this.dir(id)
    try {
      await fs.access(path.join(dir, CANVAS_FILE))
      throw new ProjectExistsError(id)
    } catch (err) {
      if (err instanceof ProjectExistsError) throw err
    }
    const doc = emptyCanvas(id, name)
    await fs.mkdir(path.join(dir, 'design-system'), { recursive: true })
    await this.writeDoc(id, doc)
    await this.writeIfAbsent(dir, 'context.md', CONTEXT_TEMPLATE)
    await this.writeIfAbsent(dir, 'design-system/guidelines.md', GUIDELINES_TEMPLATE)
    await this.writeIfAbsent(dir, 'design-system/tokens.json', TOKENS_TEMPLATE)
    return doc
  }

  private async writeIfAbsent(dir: string, rel: string, text: string): Promise<void> {
    const file = resolveInside(dir, rel)
    try {
      await fs.access(file)
      return
    } catch {
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, text)
    }
  }

  async getProject(id: string): Promise<CanvasDoc> {
    return this.readDoc(id)
  }

  async updateProject(id: string, mutate: (doc: CanvasDoc) => CanvasDoc): Promise<CanvasDoc> {
    return this.withLock(id, async () => {
      const current = await this.readDoc(id)
      const next = parseCanvas(mutate(structuredClone(current)))
      await this.writeDoc(id, next)
      return next
    })
  }

  async updateBoardPosition(id: string, boardId: string, x: number, y: number): Promise<BoardSpec> {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new CanvasError('invalid', '坐标必须是有限数字')
    let updated: BoardSpec | undefined
    await this.updateProject(id, (doc) => {
      const board = doc.boards.find((b) => b.id === boardId)
      if (!board) throw new CanvasError('not-found', `画板不存在：${boardId}`)
      board.x = Math.round(x)
      board.y = Math.round(y)
      updated = board
      return doc
    })
    if (!updated) throw new CanvasError('not-found', `画板不存在：${boardId}`)
    return updated
  }

  async addBoard(
    id: string,
    input: { id: string; name: string; width?: number; height?: number; file?: string },
  ): Promise<BoardSpec> {
    const { id: boardId, name } = input
    if (!isId(boardId)) throw new CanvasError('invalid', `画板 id 不合法：${boardId}`)
    if (typeof name !== 'string' || name.trim() === '') throw new CanvasError('invalid', '画板名称不能为空')
    const dir = this.dir(id)

    let created: BoardSpec | undefined
    await this.updateProject(id, (doc) => {
      if (doc.boards.some((b) => b.id === boardId)) throw new CanvasError('exists', `画板已存在：${boardId}`)
      const order = doc.boards.reduce((max, b) => Math.max(max, b.order ?? 0), 0) + 1
      const pos = nextBoardPosition(doc.boards)
      const board = makeBoard({
        id: boardId,
        name,
        width: input.width,
        height: input.height,
        x: pos.x,
        y: pos.y,
        order,
      })
      doc.boards.push(board)
      created = board
      return doc
    })
    if (!created) throw new CanvasError('invalid', '新建画板失败')
    const board = created
    const file = resolveInside(dir, board.file)
    try {
      await fs.access(file)
    } catch {
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, boardSkeleton(board))
    }
    return board
  }

  async listArtboards(id: string): Promise<BoardSpec[]> {
    const doc = await this.readDoc(id)
    return doc.boards
  }
}
