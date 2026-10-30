/**
 * ProjectRepository 的 R2 实现，语义与本地版一致：读-改-写 layout.json，
 * 新建项目写骨架文件，新建画板自动摆到现有画板右侧。
 *
 * 云端没有本地那套进程内写队列；并发写同一份 layout.json 时后写的赢，
 * 与「最后一次拖拽算数」的直觉一致。
 */
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
} from '@tian-s-org/schema'
import { CONTEXT_TEMPLATE, boardSkeleton } from '@tian-s-org/schema'
import { projectKey } from './paths'
import type { R2Storage } from './storage'

export const LAYOUT_FILE = 'layout.json'

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

export interface ProjectSummary {
  id: string
  name: string
  boardCount: number
  mtime: number
}

export class CloudProjectRepository {
  private readonly storage: R2Storage

  constructor(storage: R2Storage) {
    this.storage = storage
  }

  private assertId(projectId: string): void {
    if (!isId(projectId)) throw new CanvasError('invalid', `项目 id 不合法：${projectId}`)
  }

  private async readDoc(projectId: string): Promise<CanvasDoc> {
    this.assertId(projectId)
    const text = await this.storage.readText(projectKey(projectId, LAYOUT_FILE)).catch(() => null)
    if (text === null) throw new ProjectNotFoundError(projectId)
    return parseCanvas(JSON.parse(text))
  }

  private async writeDoc(projectId: string, doc: CanvasDoc): Promise<void> {
    await this.storage.writeFile(projectKey(projectId, LAYOUT_FILE), formatCanvas(doc))
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const page = await this.storage.listFiles('')
    const ids = new Set<string>()
    for (const entry of page) {
      const slash = entry.path.indexOf('/')
      if (slash > 0) ids.add(entry.path.slice(0, slash))
    }
    const out: ProjectSummary[] = []
    for (const id of ids) {
      if (!isId(id)) continue
      try {
        const version = await this.storage.getVersion(projectKey(id, LAYOUT_FILE))
        if (!version) continue
        const doc = await this.readDoc(id)
        out.push({ id: doc.id, name: doc.name, boardCount: doc.boards.length, mtime: version.mtime })
      } catch {
        // 坏项目不进列表
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id))
  }

  async createProject(input: { id: string; name: string }): Promise<CanvasDoc> {
    const { id, name } = input
    this.assertId(id)
    if (typeof name !== 'string' || name.trim() === '') throw new CanvasError('invalid', '项目名称不能为空')
    if (await this.storage.exists(projectKey(id, LAYOUT_FILE))) throw new ProjectExistsError(id)
    const doc = emptyCanvas(id, name)
    await this.writeDoc(id, doc)
    await this.writeIfAbsent(id, 'context.md', CONTEXT_TEMPLATE)
    return doc
  }

  private async writeIfAbsent(projectId: string, rel: string, text: string): Promise<void> {
    const key = projectKey(projectId, rel)
    if (await this.storage.exists(key)) return
    await this.storage.writeFile(key, text)
  }

  async getProject(id: string): Promise<CanvasDoc> {
    return this.readDoc(id)
  }

  async updateProject(id: string, mutate: (doc: CanvasDoc) => CanvasDoc): Promise<CanvasDoc> {
    const current = await this.readDoc(id)
    const next = parseCanvas(mutate(structuredClone(current)))
    await this.writeDoc(id, next)
    return next
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
    input: { id: string; name: string; width?: number; height?: number },
  ): Promise<BoardSpec> {
    const { id: boardId, name } = input
    if (!isId(boardId)) throw new CanvasError('invalid', `画板 id 不合法：${boardId}`)
    if (typeof name !== 'string' || name.trim() === '') throw new CanvasError('invalid', '画板名称不能为空')

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
    if (!(await this.storage.exists(projectKey(id, board.file)))) {
      await this.storage.writeFile(projectKey(id, board.file), boardSkeleton(board))
    }
    return board
  }

  async listArtboards(id: string): Promise<BoardSpec[]> {
    return (await this.readDoc(id)).boards
  }
}
