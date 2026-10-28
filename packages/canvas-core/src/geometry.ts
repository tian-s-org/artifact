/* 画布核心的纯计算：变换、缩放锚点、包围盒、取景、网格间距。
   这一层不碰 DOM 事件，也不依赖 React——原型技能与 artifact 都从这里取。 */

export interface Transform {
  /** 世界层在视口里的位移（屏幕像素） */
  x: number
  y: number
  /** CSS zoom 的倍数 */
  scale: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const DEFAULT_MIN_SCALE = 0.05
export const DEFAULT_MAX_SCALE = 8

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** 以视口内某点 (px, py) 为锚点缩放到 nextScale：该点下的世界坐标保持不动。
 *  所有元素都在世界坐标里同比缩放，没有反缩放的固定尺寸元素，所以一次位移就够。 */
export function zoomAround(t: Transform, px: number, py: number, nextScale: number): Transform {
  const k = nextScale / t.scale
  if (k === 1) return t
  return { x: px - (px - t.x) * k, y: py - (py - t.y) * k, scale: nextScale }
}

/** 量元素自然尺寸时先回到 zoom 1、摘掉 minWidth：这两个值都按自己缩放后的
 *  坐标解析，一缩放过 offsetWidth 就成了「窗口宽 / zoom」，越量越大。 */
export function naturalSize(el: HTMLElement): { width: number; height: number } {
  const prevZoom = el.style.zoom
  const prevMinWidth = el.style.minWidth
  el.style.zoom = '1'
  el.style.minWidth = '0px'
  const width = el.offsetWidth
  const height = el.offsetHeight
  el.style.zoom = prevZoom
  el.style.minWidth = prevMinWidth
  return { width: width || 1, height: height || 1 }
}

/** 元素在世界坐标里的矩形：屏幕矩形减掉位移、除以缩放。 */
export function worldRect(el: Element, t: Transform): Rect {
  const r = el.getBoundingClientRect()
  return {
    x: (r.left - t.x) / t.scale,
    y: (r.top - t.y) / t.scale,
    width: r.width / t.scale,
    height: r.height / t.scale,
  }
}

export function unionRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const r of rects) {
    left = Math.min(left, r.x)
    top = Math.min(top, r.y)
    right = Math.max(right, r.x + r.width)
    bottom = Math.max(bottom, r.y + r.height)
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export interface FitOptions {
  /** contain：整块塞进视口；width：只按宽度取景（高度可能超出，和原型画布一致） */
  mode?: 'contain' | 'width'
  padding?: number
  minScale?: number
  maxScale?: number
  /** 取景后左上角的留白，默认与 padding 相同 */
  offsetX?: number
  offsetY?: number
}

/** 把世界坐标里的矩形放进视口。 */
export function fitRect(
  bounds: Rect,
  viewport: { width: number; height: number },
  opts: FitOptions = {},
): Transform {
  const {
    mode = 'contain',
    padding = 40,
    minScale = DEFAULT_MIN_SCALE,
    maxScale = 1,
    offsetX = padding,
    offsetY = padding,
  } = opts
  const availW = Math.max(1, viewport.width - padding * 2)
  const availH = Math.max(1, viewport.height - padding * 2)
  const byWidth = availW / bounds.width
  const byHeight = mode === 'contain' ? availH / bounds.height : Infinity
  const scale = clamp(Math.min(maxScale, byWidth, byHeight), minScale, maxScale)
  const x = mode === 'contain'
    ? (viewport.width - bounds.width * scale) / 2 - bounds.x * scale
    : offsetX - bounds.x * scale
  const y = mode === 'contain'
    ? (viewport.height - bounds.height * scale) / 2 - bounds.y * scale
    : offsetY - bounds.y * scale
  return { x, y, scale }
}

/** 点阵网格的屏幕间距：落在 [20, 48] 像素里最好看，超出就成倍调整。 */
export function gridSpacing(base: number, scale: number): number {
  let sp = base * scale
  if (!Number.isFinite(sp) || sp <= 0) return base
  while (sp < 20) sp *= 2
  while (sp > 48) sp /= 2
  return sp
}
