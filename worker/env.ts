/** Worker 绑定与环境变量。secrets 用 `wrangler secret put` 写，不进仓库。 */
export interface Env {
  /** R2：layout.json、画板 HTML、资源、CLI token */
  FILES: Bucket
  /** 前端静态资源 */
  ASSETS: { fetch(input: Request | string, init?: RequestInit): Promise<Response> }
  /** 应用域名（artifact.tianyw0.xyz） */
  APP_HOST: string
  /** 画板文件域名（artifact-files.tianyw0.xyz） */
  FILES_HOST: string
  /** Google OAuth；不配就是本地开发模式（全放开） */
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  /** 会话签名与文件令牌的密钥；不设就复用 GOOGLE_CLIENT_SECRET */
  SESSION_SECRET?: string
  /** 允许登录的邮箱，逗号分隔 */
  ALLOWED_EMAILS?: string
  /** 允许登录的域名（比如 tian-s.org） */
  ALLOWED_DOMAIN?: string
  /** `wrangler dev` 时设为 1：文件源退回同源 /f/，不用真的第二域名 */
  DEV?: string
}

/** R2Bucket 里我们真正用到的那一小部分，测试用内存实现替换 */
export interface BucketObject {
  size: number
  uploaded?: Date
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
}

export interface BucketObjectHead {
  size: number
  uploaded?: Date
}

export interface BucketListed {
  key: string
  size: number
  uploaded?: Date
}

export interface BucketListResult {
  objects: BucketListed[]
  truncated: boolean
  cursor?: string
  delimitedPrefixes?: string[]
}

export interface Bucket {
  get(key: string): Promise<BucketObject | null>
  head(key: string): Promise<BucketObjectHead | null>
  put(key: string, value: ArrayBuffer | Uint8Array | string): Promise<unknown>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string; delimiter?: string; cursor?: string }): Promise<BucketListResult>
}
