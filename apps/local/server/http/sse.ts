/**
 * /events?project=:pid —— 画板级 SSE。
 *
 * 前端只按事件换对应画板的 ?v=mtime，不整页刷新；15 秒一次注释心跳防止中间层掐断。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isId } from '../../shared/canvas-schema'
import type { EventProvider } from '../storage/types'

const HEARTBEAT_MS = 15_000

export function handleEvents(req: IncomingMessage, res: ServerResponse, bus: EventProvider, url: URL): void {
  const project = url.searchParams.get('project')
  if (project !== null && !isId(project)) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('bad project id')
    return
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'access-control-allow-origin': '*',
  })
  res.write('retry: 2000\n\n')
  res.write('event: hello\ndata: {"ok":true}\n\n')

  const unsubscribe = bus.subscribe((event) => {
    if (project !== null && event.projectId !== project) return
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  })

  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS)
  heartbeat.unref?.()

  const cleanup = (): void => {
    clearInterval(heartbeat)
    unsubscribe()
  }
  req.on('close', cleanup)
  res.on('close', cleanup)
}
