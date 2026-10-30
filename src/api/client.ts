/**
 * 前端唯一后端入口。全部走相对路径；云端一个部署一个画布。
 */
import type { CanvasDoc } from '@tian-s-org/schema'

export interface BoardMeta {
  id: string
  mtime: number
  exists: boolean
}

export interface StatePayload {
  layout: CanvasDoc | null
  boards: BoardMeta[]
  layoutMtime: number
  /** 画板文件所在的基地址：云端是独立文件源上的带令牌地址 */
  filesBase: string
}

export interface Meta {
  cloud: boolean
  gated: boolean
  canWrite: boolean
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, { ...init, headers: init?.headers })
  } catch (err) {
    throw new ApiError(0, 'network', `连接不上画布服务：${(err as Error).message}`)
  }
  const text = await res.text()
  const data = text ? (JSON.parse(text) as unknown) : {}
  if (!res.ok) {
    const error = (data as { error?: { code?: string; message?: string } }).error
    throw new ApiError(res.status, error?.code ?? 'http', error?.message ?? `请求失败（${res.status}）`)
  }
  return data as T
}

export function fetchMeta(): Promise<Meta> {
  return request('/api/meta')
}

export function fetchState(): Promise<StatePayload> {
  return request('/api/state')
}

/** 画板文件地址：带 ?v=<mtime>，内容不变就不重载 iframe */
export function boardSrc(file: string, mtime: number, filesBase: string): string {
  const base = filesBase.replace(/\/$/, '')
  const version = mtime > 0 ? `?v=${Math.round(mtime)}` : ''
  return `${base}/${file}${version}`
}
