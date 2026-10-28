/**
 * 三个 Provider 接口（规格里的抽象要求）。本地用文件系统实现；
 * 将来接云端只要换实现，画布组件与 HTTP 层不用动。
 */
import type { BoardSpec, CanvasDoc } from '../../shared/canvas-schema'

export interface FileEntry {
  /** 相对项目根目录的 POSIX 路径 */
  path: string
  mtime: number
  size: number
}

export interface StorageProvider {
  readFile(path: string): Promise<Uint8Array>
  readText(path: string): Promise<string>
  /** 原子写：先写临时文件再 rename，避免监听端读到半个 JSON */
  writeFile(path: string, data: Uint8Array | string): Promise<void>
  listFiles(prefix: string): Promise<FileEntry[]>
  deleteFile(path: string): Promise<void>
  getVersion(path: string): Promise<{ mtime: number; hash: string } | null>
}

export interface CreateProjectInput {
  id: string
  name: string
}

export interface ProjectRepository {
  listProjects(): Promise<{ id: string; name: string; boardCount: number; mtime: number }[]>
  createProject(input: CreateProjectInput): Promise<CanvasDoc>
  getProject(id: string): Promise<CanvasDoc>
  /** 读-改-写，同一项目的写操作串行 */
  updateProject(id: string, mutate: (doc: CanvasDoc) => CanvasDoc): Promise<CanvasDoc>
  updateBoardPosition(id: string, boardId: string, x: number, y: number): Promise<BoardSpec>
  addBoard(id: string, input: { id: string; name: string; width?: number; height?: number }): Promise<BoardSpec>
  listArtboards(id: string): Promise<BoardSpec[]>
}

export type CanvasEvent =
  | { type: 'board:changed'; projectId: string; boardId: string; mtime: number }
  | { type: 'board:added'; projectId: string; boardId: string }
  | { type: 'board:removed'; projectId: string; boardId: string }
  | { type: 'canvas:changed'; projectId: string; mtime: number }
  | { type: 'version:saved'; projectId: string; versionId: string }
  | { type: 'project:error'; projectId: string; code: string; message: string }

export interface EventProvider {
  subscribe(listener: (event: CanvasEvent) => void): () => void
  publish(event: CanvasEvent): void
}
