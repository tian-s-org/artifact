/**
 * 版本管理：内容寻址的 blob + 一份索引。
 *
 *   versions/index.json          [{ id, at, note, canvas, boards }]，新的在前
 *   versions/blobs/<sha256 16>   文件原样字节，同内容只存一份
 *
 * 恢复前先自动存一份 auto 备份，恢复只写目标画板的文件（指定 boardId 时连
 * canvas.json 都不动），所以「恢复画板 A」不会碰到画板 B。
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { CanvasError, isId, parseCanvas } from '@tian-s-org/schema'
import { projectDir, resolveInside } from '../paths'
import { withProjectLock } from './locks'
import { CANVAS_FILE } from './project-repo'

export const VERSIONS_DIR = 'versions'
export const VERSIONS_INDEX = 'versions/index.json'
const BLOB_DIR = 'versions/blobs'

/** v20261029-073000、v20261029-073000-2 */
export const VERSION_ID_RE = /^v[0-9]{8}-[0-9]{6}(?:-[0-9]+)?$/
const HASH_RE = /^[0-9a-f]{16}$/

export interface SavedFile {
  /** blob 名 */
  hash: string
  /** 恢复时写回哪里（相对项目根） */
  file: string
}

export interface VersionEntry {
  id: string
  /** ISO 时间 */
  at: string
  note: string
  /** 恢复前自动存的备份 */
  auto?: boolean
  canvas: SavedFile
  /** 画板 id → 文件 */
  boards: Record<string, SavedFile>
}

export interface VersionIndex {
  protocol: 1
  versions: VersionEntry[]
}

export interface RestoreResult {
  version: VersionEntry
  /** 这次恢复前自动存的备份 id */
  backupId: string
  /** 被写回的画板 id */
  restored: string[]
}

function hashOf(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 16)
}

function stamp(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    'v' +
    at.getUTCFullYear() +
    pad(at.getUTCMonth() + 1) +
    pad(at.getUTCDate()) +
    '-' +
    pad(at.getUTCHours()) +
    pad(at.getUTCMinutes()) +
    pad(at.getUTCSeconds())
  )
}

function nextVersionId(existing: VersionEntry[]): string {
  const base = stamp(new Date())
  let id = base
  let suffix = 2
  while (existing.some((entry) => entry.id === id)) id = `${base}-${suffix++}`
  return id
}

async function readIndex(dir: string): Promise<VersionIndex> {
  let text: string
  try {
    text = await fs.readFile(resolveInside(dir, VERSIONS_INDEX), 'utf8')
  } catch {
    return { protocol: 1, versions: [] }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new CanvasError('invalid', 'versions/index.json 不是合法 JSON')
  }
  const versions = (parsed as { versions?: unknown }).versions
  if (!Array.isArray(versions)) throw new CanvasError('invalid', 'versions/index.json 缺少 versions 数组')
  const valid = versions.filter((entry): entry is VersionEntry => {
    const anyEntry = entry as Partial<VersionEntry>
    return typeof anyEntry?.id === 'string' && VERSION_ID_RE.test(anyEntry.id) && typeof anyEntry.at === 'string'
  })
  return { protocol: 1, versions: valid }
}

async function writeIndex(dir: string, index: VersionIndex): Promise<void> {
  const file = resolveInside(dir, VERSIONS_INDEX)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tmp, `${JSON.stringify(index, null, 2)}\n`)
  await fs.rename(tmp, file)
}

/** 原子写：先写同目录临时文件再 rename，监听端不会读到半个文件 */
async function writeAtomic(dir: string, rel: string, data: Buffer | string): Promise<void> {
  const file = resolveInside(dir, rel)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = path.join(path.dirname(file), `.tmp-${process.pid}-${Date.now()}-${path.basename(file)}`)
  await fs.writeFile(tmp, data)
  await fs.rename(tmp, file)
}

export class FsVersionStore {
  private readonly root: string

  constructor(root: string) {
    this.root = root
  }

  private dir(projectId: string): string {
    if (!isId(projectId)) throw new CanvasError('invalid', `项目 id 不合法：${projectId}`)
    return projectDir(this.root, projectId)
  }

  async list(projectId: string): Promise<VersionEntry[]> {
    return (await readIndex(this.dir(projectId))).versions
  }

  async save(projectId: string, note: string, options: { auto?: boolean; autoNote?: string } = {}): Promise<VersionEntry> {
    const trimmed = note.trim()
    if (trimmed.length > 200) throw new CanvasError('invalid', '备注太长（最多 200 字）')
    return withProjectLock(projectId, async () => {
      const dir = this.dir(projectId)
      const index = await readIndex(dir)
      const entry: VersionEntry = {
        id: nextVersionId(index.versions),
        at: new Date().toISOString(),
        note: trimmed || options.autoNote || '手动保存',
        ...(options.auto ? { auto: true } : {}),
        ...(await this.snapshot(dir)),
      }
      index.versions.unshift(entry)
      await writeIndex(dir, index)
      return entry
    })
  }

  async restore(
    projectId: string,
    versionId: string,
    options: { boardId?: string } = {},
  ): Promise<RestoreResult> {
    if (!VERSION_ID_RE.test(versionId)) throw new CanvasError('invalid', `版本 id 不合法：${versionId}`)
    return withProjectLock(projectId, async () => {
      const dir = this.dir(projectId)
      const index = await readIndex(dir)
      const target = index.versions.find((entry) => entry.id === versionId)
      if (!target) throw new CanvasError('not-found', `版本不存在：${versionId}`)

      // 先给当前状态留个后路
      const backup: VersionEntry = {
        id: nextVersionId(index.versions),
        at: new Date().toISOString(),
        note: '恢复前自动备份',
        auto: true,
        ...(await this.snapshot(dir)),
      }
      index.versions.unshift(backup)

      const restored: string[] = []
      if (options.boardId !== undefined) {
        const saved = target.boards[options.boardId]
        if (!saved) throw new CanvasError('not-found', `版本 ${versionId} 里没有画板 ${options.boardId}`)
        await this.writeSaved(dir, saved)
        restored.push(options.boardId)
      } else {
        await this.writeSaved(dir, target.canvas)
        for (const [boardId, saved] of Object.entries(target.boards)) {
          await this.writeSaved(dir, saved)
          restored.push(boardId)
        }
      }

      await writeIndex(dir, index)
      return { version: target, backupId: backup.id, restored }
    })
  }

  /** 把当前 canvas.json 与各画板文件收进 blob；同内容不重复写 */
  private async snapshot(dir: string): Promise<{ canvas: SavedFile; boards: Record<string, SavedFile> }> {
    const canvasFile = resolveInside(dir, CANVAS_FILE)
    let text: string
    try {
      text = await fs.readFile(canvasFile, 'utf8')
    } catch {
      throw new CanvasError('not-found', 'canvas.json 不存在，无法保存版本')
    }
    const doc = parseCanvas(JSON.parse(text))
    const canvas: SavedFile = { hash: await this.putBlob(dir, Buffer.from(text, 'utf8')), file: CANVAS_FILE }

    const boards: Record<string, SavedFile> = {}
    for (const board of doc.boards) {
      let data: Buffer
      try {
        data = await fs.readFile(resolveInside(dir, board.file))
      } catch {
        continue // 文件还没写出来：这一版就跳过它，恢复时也不会把它写成空文件
      }
      boards[board.id] = { hash: await this.putBlob(dir, data), file: board.file }
    }
    return { canvas, boards }
  }

  private async putBlob(dir: string, data: Buffer): Promise<string> {
    const hash = hashOf(data)
    const file = resolveInside(dir, path.posix.join(BLOB_DIR, hash))
    try {
      await fs.access(file)
      return hash
    } catch {
      /* 没有就写 */
    }
    await writeAtomic(dir, path.posix.join(BLOB_DIR, hash), data)
    return hash
  }

  private async writeSaved(dir: string, saved: SavedFile): Promise<void> {
    if (!HASH_RE.test(saved.hash)) throw new CanvasError('invalid', `版本数据里的 hash 不合法：${saved.hash}`)
    const blob = resolveInside(dir, path.posix.join(BLOB_DIR, saved.hash))
    let data: Buffer
    try {
      data = await fs.readFile(blob)
    } catch {
      throw new CanvasError('invalid', `版本数据缺失：${saved.hash}`)
    }
    // 已经和这一版一样就不写：mtime 不动，画布也不会白白重载这块画板
    try {
      if ((await fs.readFile(resolveInside(dir, saved.file))).equals(data)) return
    } catch {
      /* 文件不在，下面照常写 */
    }
    await writeAtomic(dir, saved.file, data)
  }
}
