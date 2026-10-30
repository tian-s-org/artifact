/** 测试用的内存 R2：只实现我们用到的那几个方法，行为与 R2 一致（含 uploaded 时间） */
import type { Bucket, BucketListResult, BucketObject, BucketObjectHead, Env } from '../../worker/env'

interface Stored {
  data: Uint8Array
  uploaded: Date
}

export class MemoryBucket implements Bucket {
  readonly map = new Map<string, Stored>()
  /** 每次 put 都把时间往后挪 1ms，避免同一毫秒内两次写看不出 mtime 变化 */
  private clock = Date.now()

  private tick(): Date {
    this.clock += 1
    return new Date(this.clock)
  }

  async get(key: string): Promise<BucketObject | null> {
    const item = this.map.get(key)
    if (!item) return null
    const bytes = item.data
    return {
      size: bytes.byteLength,
      uploaded: item.uploaded,
      arrayBuffer: async () => bytes.slice().buffer,
      text: async () => new TextDecoder().decode(bytes),
    }
  }

  async head(key: string): Promise<BucketObjectHead | null> {
    const item = this.map.get(key)
    return item ? { size: item.data.byteLength, uploaded: item.uploaded } : null
  }

  async put(key: string, value: ArrayBuffer | Uint8Array | string): Promise<unknown> {
    const data =
      typeof value === 'string'
        ? new TextEncoder().encode(value)
        : value instanceof Uint8Array
          ? value.slice()
          : new Uint8Array(value)
    this.map.set(key, { data, uploaded: this.tick() })
    return {}
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key)
  }

  async list(options: { prefix?: string; delimiter?: string; cursor?: string } = {}): Promise<BucketListResult> {
    const prefix = options.prefix ?? ''
    const keys = [...this.map.keys()].filter((key) => key.startsWith(prefix)).sort()
    return {
      objects: keys.map((key) => ({ key, size: this.map.get(key)?.data.byteLength ?? 0, uploaded: this.map.get(key)?.uploaded })),
      truncated: false,
    }
  }

  text(key: string): string {
    return new TextDecoder().decode(this.map.get(key)?.data ?? new Uint8Array())
  }
}

export function makeEnv(bucket: Bucket, overrides: Partial<Env> = {}): Env {
  return {
    FILES: bucket,
    ASSETS: { fetch: async () => new Response('asset') },
    APP_HOST: 'artifact.test',
    FILES_HOST: 'artifact-files.test',
    ...overrides,
  }
}
