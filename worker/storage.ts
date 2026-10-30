/**
 * StorageProvider 的 R2 实现。
 *
 * 键就是本地版的相对路径，前面加 `<项目 id>/`；R2 的单对象 put 本身是原子的，
 * 不需要本地那套「写临时文件再 rename」。
 */
import { CanvasError } from '@tian-s-org/schema'
import type { Bucket } from './env'

export interface FileEntry {
  path: string
  mtime: number
  size: number
}

function uploadedMs(obj: { uploaded?: Date }): number {
  return obj.uploaded ? obj.uploaded.getTime() : 0
}

export class R2Storage {
  private readonly bucket: Bucket

  constructor(bucket: Bucket) {
    this.bucket = bucket
  }

  async readFile(key: string): Promise<Uint8Array> {
    const obj = await this.bucket.get(key)
    if (!obj) throw new CanvasError('not-found', `文件不存在：${key}`)
    return new Uint8Array(await obj.arrayBuffer())
  }

  async readText(key: string): Promise<string> {
    const obj = await this.bucket.get(key)
    if (!obj) throw new CanvasError('not-found', `文件不存在：${key}`)
    return obj.text()
  }

  async writeFile(key: string, data: Uint8Array | string): Promise<void> {
    await this.bucket.put(key, data)
  }

  /** 列出某个前缀下的全部对象（R2 list 每页 1000，这里翻完） */
  async listFiles(prefix: string): Promise<FileEntry[]> {
    const out: FileEntry[] = []
    let cursor: string | undefined
    do {
      const page = await this.bucket.list(cursor === undefined ? { prefix } : { prefix, cursor })
      for (const obj of page.objects) {
        out.push({ path: obj.key, mtime: uploadedMs(obj), size: obj.size })
      }
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor !== undefined)
    return out
  }

  async deleteFile(key: string): Promise<void> {
    await this.bucket.delete(key)
  }

  async getVersion(key: string): Promise<{ mtime: number; hash: string } | null> {
    const head = await this.bucket.head(key)
    if (!head) return null
    return { mtime: uploadedMs(head), hash: '' }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.bucket.head(key)) !== null
  }

  async readSource(key: string): Promise<{ text: string } | null> {
    const obj = await this.bucket.get(key)
    if (!obj) return null
    return { text: await obj.text() }
  }
}
