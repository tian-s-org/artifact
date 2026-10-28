/**
 * StorageProvider 的文件系统实现。所有键都是相对项目根目录的 POSIX 路径。
 * 写入一律「临时文件 + rename」：监听端要么看到旧内容，要么看到新内容。
 */
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveInside } from '../paths'
import type { FileEntry, StorageProvider } from './types'

/** 临时写入的文件名前缀，监听端一律忽略 */
export const TMP_PREFIX = '.tmp-'

const SKIP_DIRS = new Set(['node_modules', '.git', '.tmp', 'dist', 'dist-server'])

export class FsStorageProvider implements StorageProvider {
  readonly root: string

  constructor(root: string) {
    this.root = root
  }

  private abs(rel: string): string {
    return resolveInside(this.root, rel)
  }

  async readFile(rel: string): Promise<Uint8Array> {
    return new Uint8Array(await fs.readFile(this.abs(rel)))
  }

  async readText(rel: string): Promise<string> {
    return fs.readFile(this.abs(rel), 'utf8')
  }

  async writeFile(rel: string, data: Uint8Array | string): Promise<void> {
    const abs = this.abs(rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    const tmp = path.join(path.dirname(abs), `${TMP_PREFIX}${randomBytes(6).toString('hex')}`)
    await fs.writeFile(tmp, data)
    try {
      await fs.rename(tmp, abs)
    } catch (err) {
      await fs.rm(tmp, { force: true })
      throw err
    }
  }

  async writeFileIfAbsent(rel: string, data: Uint8Array | string): Promise<boolean> {
    try {
      await fs.access(this.abs(rel))
      return false
    } catch {
      await this.writeFile(rel, data)
      return true
    }
  }

  async listFiles(prefix: string): Promise<FileEntry[]> {
    const base = prefix === '' ? this.root : this.abs(prefix)
    const entries: FileEntry[] = []
    const walk = async (dir: string): Promise<void> => {
      let items
      try {
        items = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const item of items) {
        if (item.name.startsWith('.') || SKIP_DIRS.has(item.name)) continue
        const abs = path.join(dir, item.name)
        if (item.isDirectory()) {
          await walk(abs)
          continue
        }
        if (!item.isFile()) continue
        const stat = await fs.stat(abs)
        entries.push({
          path: path.relative(this.root, abs).split(path.sep).join('/'),
          mtime: stat.mtimeMs,
          size: stat.size,
        })
      }
    }
    await walk(base)
    return entries.sort((a, b) => a.path.localeCompare(b.path))
  }

  async deleteFile(rel: string): Promise<void> {
    await fs.rm(this.abs(rel), { force: true })
  }

  async getVersion(rel: string): Promise<{ mtime: number; hash: string } | null> {
    const abs = this.abs(rel)
    let stat
    try {
      stat = await fs.stat(abs)
    } catch {
      return null
    }
    const data = await fs.readFile(abs)
    return { mtime: stat.mtimeMs, hash: createHash('sha256').update(data).digest('hex') }
  }
}
