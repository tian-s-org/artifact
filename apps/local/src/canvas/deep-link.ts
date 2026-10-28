/**
 * 深链：`/p/<项目>?focus=<画板 id>&scale=<倍数>`
 *
 * 分享一个链接就能直接落在某块画板上；scale 不写就按这块画板取景，
 * 写了就按给定倍数居中。focus 指向不存在的画板时只当没写。
 */
import type { Rect } from '@artifact/canvas-core'
import { DEFAULT_MAX_SCALE, DEFAULT_MIN_SCALE } from '@artifact/canvas-core'
import type { BoardView } from './types'

export interface DeepLink {
  /** 要对准的矩形；只给了 scale 时为 null */
  rect: Rect | null
  /** 链接里写死的缩放；没写或越界时为 null */
  scale: number | null
}

export function readDeepLink(search: string, boards: BoardView[]): DeepLink | null {
  const params = new URLSearchParams(search)
  const focusId = params.get('focus')
  const raw = params.get('scale')
  const parsed = raw === null ? NaN : Number(raw)
  const scale =
    Number.isFinite(parsed) && parsed >= DEFAULT_MIN_SCALE && parsed <= DEFAULT_MAX_SCALE ? parsed : null

  const board = focusId ? boards.find((b) => b.id === focusId) : undefined
  if (!board && scale === null) return null

  return {
    rect: board ? { x: board.x, y: board.y, width: board.width, height: board.height } : null,
    scale,
  }
}
