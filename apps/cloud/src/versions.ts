/**
 * 版本管理的云端实现：内容寻址 blob + 一份索引，语义与本地版逐条对齐。
 *
 *   versions/index.json          [{ id, at, note, canvas, boards }]，新的在前
 *   versions/blobs/<sha256 16>   文件原样字节，同内容只存一份
 *
 * 恢复前自动存一份 auto 备份；指定 boardId 时只写那一块画板。
 */
import { CanvasError, isId, parseCanvas } from '@tian-s-org/schema'
import { projectKey } from './paths'
import { LAYOUT_FILE } from './repo'
import type { R2Storage } from './storage'

export const VERSIONS_INDEX = 'versions/index.json'
const BLOB_PREFIX = 'versions/blobs/'

export const VERSION_ID_RE = /^v[0-9]{8}-[0-9]{6}(?:-[0-9]+)?$/
const HASH_RE = /^[0-9a-f]{16}$/

export interface SavedFile {
  hash: string
  file: string
}

export interface VersionEntry {
  id: string
  at: string
  note: string
  auto?: boolean
  canvas: SavedFile
  boards: Record<string, SavedFile>
}

export interface VersionIndex {
  protocol: 1
  versions: VersionEntry[]
}

export interface RestoreResult {
  version: VersionEntry
  backupId: string
  restored: string[]
}

async function hashOf(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  let hex = ''
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0')
  return hex.slice(0, 16)
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

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
}

export class CloudVersionStore {
  private readonly storage: R2Storage

  constructor(storage: R2Storage) {
    this.storage = storage
  }

  private key(projectId: string, rel: string): string {
    if (!isId(projectId)) throw new CanvasError('invalid', `项目 id 不合法：${projectId}`)
    return projectKey(projectId, rel)
  }

  private async readIndex(projectId: string): Promise<VersionIndex> {
    let text: string
    try {
      text = await this.storage.readText(this.key(projectId, VERSIONS_INDEX))
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

  private async writeIndex(projectId: string, index: VersionIndex): Promise<void> {
    await this.storage.writeFile(this.key(projectId, VERSIONS_INDEX), `${JSON.stringify(index, null, 2)}\n`)
  }

  async list(projectId: string): Promise<VersionEntry[]> {
    return (await this.readIndex(projectId)).versions
  }

  async save(
    projectId: string,
    note: string,
    options: { auto?: boolean; autoNote?: string } = {},
  ): Promise<VersionEntry> {
    const trimmed = note.trim()
    if (trimmed.length > 200) throw new CanvasError('invalid', '备注太长（最多 200 字）')
    const index = await this.readIndex(projectId)
    const entry: VersionEntry = {
      id: nextVersionId(index.versions),
      at: new Date().toISOString(),
      note: trimmed || options.autoNote || '手动保存',
      ...(options.auto ? { auto: true } : {}),
      ...(await this.snapshot(projectId)),
    }
    index.versions.unshift(entry)
    await this.writeIndex(projectId, index)
    return entry
  }

  async restore(
    projectId: string,
    versionId: string,
    options: { boardId?: string } = {},
  ): Promise<RestoreResult> {
    if (!VERSION_ID_RE.test(versionId)) throw new CanvasError('invalid', `版本 id 不合法：${versionId}`)
    const index = await this.readIndex(projectId)
    const target = index.versions.find((entry) => entry.id === versionId)
    if (!target) throw new CanvasError('not-found', `版本不存在：${versionId}`)

    const backup: VersionEntry = {
      id: nextVersionId(index.versions),
      at: new Date().toISOString(),
      note: '恢复前自动备份',
      auto: true,
      ...(await this.snapshot(projectId)),
    }
    index.versions.unshift(backup)

    const restored: string[] = []
    if (options.boardId !== undefined) {
      const saved = target.boards[options.boardId]
      if (!saved) throw new CanvasError('not-found', `版本 ${versionId} 里没有画板 ${options.boardId}`)
      await this.writeSaved(projectId, saved)
      restored.push(options.boardId)
    } else {
      await this.writeSaved(projectId, target.canvas)
      for (const [boardId, saved] of Object.entries(target.boards)) {
        await this.writeSaved(projectId, saved)
        restored.push(boardId)
      }
    }

    await this.writeIndex(projectId, index)
    return { version: target, backupId: backup.id, restored }
  }

  private async snapshot(projectId: string): Promise<{ canvas: SavedFile; boards: Record<string, SavedFile> }> {
    const text = await this.storage.readText(this.key(projectId, LAYOUT_FILE)).catch(() => null)
    if (text === null) throw new CanvasError('not-found', 'layout.json 不存在，无法保存版本')
    const doc = parseCanvas(JSON.parse(text))
    const canvas: SavedFile = {
      hash: await this.putBlob(projectId, new TextEncoder().encode(text)),
      file: LAYOUT_FILE,
    }

    const boards: Record<string, SavedFile> = {}
    for (const board of doc.boards) {
      let data: Uint8Array
      try {
        data = await this.storage.readFile(this.key(projectId, board.file))
      } catch {
        continue // 文件还没写出来：这一版跳过它
      }
      boards[board.id] = { hash: await this.putBlob(projectId, data), file: board.file }
    }
    return { canvas, boards }
  }

  private async putBlob(projectId: string, data: Uint8Array): Promise<string> {
    const hash = await hashOf(data)
    const key = this.key(projectId, `${BLOB_PREFIX}${hash}`)
    if (!(await this.storage.exists(key))) await this.storage.writeFile(key, data)
    return hash
  }

  private async writeSaved(projectId: string, saved: SavedFile): Promise<void> {
    if (!HASH_RE.test(saved.hash)) throw new CanvasError('invalid', `版本数据里的 hash 不合法：${saved.hash}`)
    let data: Uint8Array
    try {
      data = await this.storage.readFile(this.key(projectId, `${BLOB_PREFIX}${saved.hash}`))
    } catch {
      throw new CanvasError('invalid', `版本数据缺失：${saved.hash}`)
    }
    // 已经和这一版一样就不写：mtime 不动，画布也不会白白重载这块画板
    try {
      const current = await this.storage.readFile(this.key(projectId, saved.file))
      if (sameBytes(current, data)) return
    } catch {
      /* 文件不在，下面照常写 */
    }
    await this.storage.writeFile(this.key(projectId, saved.file), data)
  }
}
