/** 响应与错误的小工具，行为对齐本地版的 server/http/respond.ts */
import { CanvasError } from '../../local/shared/canvas-schema'

export class HttpError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
    this.name = 'HttpError'
  }
}

const NO_STORE = { 'cache-control': 'no-store' }

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...NO_STORE, ...headers },
  })
}

export function fail(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } })
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    throw new HttpError(400, 'invalid', '请求体不是合法 JSON')
  }
}

function statusForCode(code: string): number {
  switch (code) {
    case 'not-found':
      return 404
    case 'exists':
      return 409
    case 'unsupported-protocol':
      return 400
    default:
      return 400
  }
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return fail(err.status, err.code, err.message)
  if (err instanceof CanvasError) return fail(statusForCode(err.code), err.code, err.message)
  const message = err instanceof Error ? err.message : String(err)
  if (/项目不存在/.test(message)) return fail(404, 'not-found', message)
  if (/项目已存在/.test(message)) return fail(409, 'exists', message)
  console.error('[api]', err)
  return fail(500, 'internal', '服务出错')
}
