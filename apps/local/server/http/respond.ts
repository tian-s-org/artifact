/** HTTP 小工具：统一 JSON 错误体、统一读请求体 */
import type { IncomingMessage, ServerResponse } from 'node:http'

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

export function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  })
  res.end(text)
}

export function fail(res: ServerResponse, status: number, code: string, message: string): void {
  json(res, status, { error: { code, message } })
}

const MAX_BODY = 1 << 20

export async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    size += buf.length
    if (size > MAX_BODY) throw new HttpError(413, 'too-large', '请求体过大')
    chunks.push(buf)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'invalid-json', '请求体不是合法 JSON')
  }
}

/** 把领域错误翻成 HTTP 错误 */
export function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err
  const anyErr = err as { code?: unknown; status?: unknown; message?: unknown }
  const message = typeof anyErr?.message === 'string' ? anyErr.message : '服务器内部错误'
  const code = typeof anyErr?.code === 'string' ? anyErr.code : 'internal'
  switch (code) {
    case 'not-found':
      return new HttpError(404, code, message)
    case 'exists':
      return new HttpError(409, code, message)
    case 'invalid':
    case 'invalid-json':
    case 'unsupported-protocol':
      return new HttpError(400, code, message)
    default:
      return new HttpError(500, code, message)
  }
}
