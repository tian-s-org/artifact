/* 画布控制器：把「视口」这件事收进一个对象。
   host 是铺满屏幕的那层（overflow: hidden），world 是它下面那个绝对定位的世界层。
   变换直接写 DOM（zoom + left/top），不进 React 状态，滚轮连发不会触发重渲染。 */

import {
  clamp,
  DEFAULT_MAX_SCALE,
  DEFAULT_MIN_SCALE,
  fitRect,
  gridSpacing,
  unionRect,
  worldRect,
  zoomAround,
  type FitOptions,
  type Rect,
  type Transform,
} from './geometry'
import { WheelClassifier, WHEEL_ZOOM_STEP } from './gestures'

export interface ViewportOptions {
  minScale?: number
  maxScale?: number
  /** 世界坐标里点阵的基准间距 */
  gridSize?: number
  gridColor?: string
  background?: string
  /** localStorage 键；null 表示不持久化 */
  persistKey?: string | null
  /** 指针是否落在空白处（决定能否拖拽平移）。默认只有 host 与 world 本身算空白。 */
  isBackground?: (target: EventTarget | null) => boolean
  /** 命中这些元素时，不加修饰键的滚轮交给它们自己滚动，不被画布吃掉 */
  nativeScrollSelector?: string
  onChange?: (t: Transform) => void
}

interface GestureLike extends UIEvent {
  scale: number
  clientX: number
  clientY: number
}

const SAVE_DELAY = 200

export class Viewport {
  private readonly host: HTMLElement
  private readonly world: HTMLElement
  private readonly opts: ViewportOptions
  private t: Transform = { x: 0, y: 0, scale: 1 }

  private readonly classifier = new WheelClassifier()
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private drag: { id: number; x: number; y: number } | null = null
  private gesturing = false
  private gestureBase = 1
  private cleanups: Array<() => void> = []

  constructor(host: HTMLElement, world: HTMLElement, opts: ViewportOptions = {}) {
    this.host = host
    this.world = world
    this.opts = opts
  }

  get transform(): Transform {
    return { ...this.t }
  }

  attach(): void {
    this.paintHost()
    this.apply()
    this.bindWheel()
    this.bindGestures()
    this.bindPointer()
    const onHide = () => this.flushSave()
    window.addEventListener('pagehide', onHide)
    this.cleanups.push(() => window.removeEventListener('pagehide', onHide))
  }

  destroy(): void {
    for (const off of this.cleanups) off()
    this.cleanups = []
    this.flushSave()
  }

  /* ── 变换 ───────────────────────────────────── */

  set(next: Partial<Transform>): void {
    const scale = clamp(
      next.scale ?? this.t.scale,
      this.opts.minScale ?? DEFAULT_MIN_SCALE,
      this.opts.maxScale ?? DEFAULT_MAX_SCALE,
    )
    this.t = { x: next.x ?? this.t.x, y: next.y ?? this.t.y, scale }
    this.apply()
  }

  setScaleOriginTo(scale: number): void {
    const box = this.host.getBoundingClientRect()
    this.zoomToScale(scale, { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 })
  }

  zoomAt(clientX: number, clientY: number, factor: number): void {
    const next = clamp(
      this.t.scale * factor,
      this.opts.minScale ?? DEFAULT_MIN_SCALE,
      this.opts.maxScale ?? DEFAULT_MAX_SCALE,
    )
    this.zoomToScale(next, { clientX, clientY })
  }

  zoomToScale(scale: number, anchor?: { clientX: number; clientY: number }): void {
    const box = this.host.getBoundingClientRect()
    const px = anchor ? anchor.clientX - box.left : box.width / 2
    const py = anchor ? anchor.clientY - box.top : box.height / 2
    const next = clamp(
      scale,
      this.opts.minScale ?? DEFAULT_MIN_SCALE,
      this.opts.maxScale ?? DEFAULT_MAX_SCALE,
    )
    this.t = zoomAround(this.t, px, py, next)
    this.apply()
  }

  panBy(dx: number, dy: number): void {
    this.t = { ...this.t, x: this.t.x + dx, y: this.t.y + dy }
    this.apply()
  }

  /** 把世界坐标里的矩形放进视口 */
  fitToRect(rect: Rect, fit: FitOptions = {}): void {
    this.set(fitRect(rect, this.hostBox(), {
      mode: 'contain',
      padding: 40,
      minScale: this.opts.minScale,
      maxScale: this.opts.maxScale,
      ...fit,
    }))
  }

  fitToRects(rects: Rect[], fit: FitOptions = {}): void {
    const bounds = unionRect(rects)
    if (bounds) this.fitToRect(bounds, fit)
  }

  fitToElements(els: Element[], fit: FitOptions = {}): void {
    this.fitToRects(els.map((el) => this.measure(el)), fit)
  }

  /** 把一块画板放到屏幕左上角 offset 处；不给 scale 就保持当前缩放 */
  focusRect(rect: Rect, opts: { scale?: number; offsetX?: number; offsetY?: number } = {}): void {
    const scale = clamp(
      opts.scale ?? this.t.scale,
      this.opts.minScale ?? DEFAULT_MIN_SCALE,
      this.opts.maxScale ?? DEFAULT_MAX_SCALE,
    )
    this.set({
      scale,
      x: (opts.offsetX ?? 40) - rect.x * scale,
      y: (opts.offsetY ?? 40) - rect.y * scale,
    })
  }

  /** 把一块矩形摆到视口正中间；深链 ?focus=&scale= 用它定位单块画板 */
  centerRect(rect: Rect, scale = this.t.scale): void {
    const s = clamp(
      scale,
      this.opts.minScale ?? DEFAULT_MIN_SCALE,
      this.opts.maxScale ?? DEFAULT_MAX_SCALE,
    )
    const box = this.hostBox()
    this.set({
      scale: s,
      x: box.width / 2 - (rect.x + rect.width / 2) * s,
      y: box.height / 2 - (rect.y + rect.height / 2) * s,
    })
  }

  /* ── 持久化 ─────────────────────────────────── */

  restoreView(): boolean {
    if (!this.opts.persistKey) return false
    try {
      const raw = localStorage.getItem(this.opts.persistKey)
      if (!raw) return false
      const saved = JSON.parse(raw) as Partial<Transform>
      if (!Number.isFinite(saved.x) || !Number.isFinite(saved.y) || !Number.isFinite(saved.scale)) {
        return false
      }
      this.set({ x: saved.x, y: saved.y, scale: saved.scale })
      return true
    } catch {
      return false
    }
  }

  /** 持久化下来的视口可能指向已经不存在的内容：一个都看不见就回到原点。 */
  resetIfNothingVisible(els: Element[]): boolean {
    if (els.length === 0) return false
    const box = this.host.getBoundingClientRect()
    const visible = els.some((el) => {
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return false
      return r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom
    })
    if (visible) return false
    this.set({ x: 0, y: 0, scale: 1 })
    return true
  }

  saveView(): void {
    this.flushSave()
  }

  /* ── 内部 ───────────────────────────────────── */

  private hostBox(): { width: number; height: number } {
    return { width: this.host.clientWidth || 1, height: this.host.clientHeight || 1 }
  }

  /** 在 zoom=1、位移归零的瞬间量元素的世界矩形：世界层的宽度依赖自身缩放，
   *  直接量会得到「窗口宽 / zoom」这种越量越大的值。 */
  private measure(el: Element): Rect {
    const w = this.world
    const prev = { zoom: w.style.zoom, left: w.style.left, top: w.style.top, minWidth: w.style.minWidth }
    w.style.zoom = '1'
    w.style.left = '0px'
    w.style.top = '0px'
    w.style.minWidth = '0px'
    const rect: Rect = el instanceof HTMLElement
      ? { x: el.offsetLeft, y: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight }
      : worldRect(el, { x: 0, y: 0, scale: 1 })
    w.style.zoom = prev.zoom
    w.style.left = prev.left
    w.style.top = prev.top
    w.style.minWidth = prev.minWidth
    return rect
  }

  private paintHost(): void {
    const color = this.opts.gridColor ?? 'rgba(0, 0, 0, 0.10)'
    this.host.style.backgroundColor = this.opts.background ?? '#f5f5f5'
    this.host.style.backgroundImage =
      `radial-gradient(circle, ${color} 1px, transparent 1px)`
    this.host.style.backgroundRepeat = 'repeat'
  }

  private apply(): void {
    const { x, y, scale } = this.t
    this.world.style.transform = 'none'
    // left/top 和 transform 的长度会被 zoom 再乘一遍，先除回来
    this.world.style.left = `${x / scale}px`
    this.world.style.top = `${y / scale}px`
    this.world.style.zoom = String(scale)
    const sp = gridSpacing(this.opts.gridSize ?? 24, scale)
    this.host.style.backgroundSize = `${sp}px ${sp}px`
    this.host.style.backgroundPosition = `${x}px ${y}px`
    this.opts.onChange?.(this.t)
    this.scheduleSave()
  }

  private scheduleSave(): void {
    if (!this.opts.persistKey) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flushSave(), SAVE_DELAY)
  }

  private flushSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (!this.opts.persistKey) return
    try {
      localStorage.setItem(this.opts.persistKey, JSON.stringify(this.t))
    } catch {
      /* 隐私模式：视口不持久化，不影响使用 */
    }
  }

  private bindWheel(): void {
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) && this.opts.nativeScrollSelector) {
        const target = e.target
        if (target instanceof Element && target.closest(this.opts.nativeScrollSelector)) return
      }
      e.preventDefault()
      if (this.gesturing) return // Safari 的 gesture* 正在接管，同一捏合里的滚轮一律丢弃
      const action = this.classifier.classify(e)
      if (action === 'pinch') {
        this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01))
      } else if (action === 'step') {
        this.zoomAt(e.clientX, e.clientY, Math.exp(-Math.sign(e.deltaY) * WHEEL_ZOOM_STEP))
      } else {
        this.panBy(-e.deltaX, -e.deltaY)
      }
    }
    this.host.addEventListener('wheel', onWheel, { passive: false })
    this.cleanups.push(() => this.host.removeEventListener('wheel', onWheel))
  }

  private bindGestures(): void {
    // Safari 的触控板捏合发原生 gesture* 事件，带平滑的 e.scale；其他浏览器没有这些事件，绑了也不触发
    const onStart = (e: GestureLike) => {
      e.preventDefault()
      this.gesturing = true
      this.gestureBase = this.t.scale
    }
    const onChange = (e: GestureLike) => {
      e.preventDefault()
      this.zoomAt(e.clientX, e.clientY, (this.gestureBase * e.scale) / this.t.scale)
    }
    const onEnd = (e: GestureLike) => {
      e.preventDefault()
      this.gesturing = false
      this.classifier.reset()
    }
    const host = this.host as HTMLElement & {
      addEventListener(t: string, fn: (e: GestureLike) => void, o?: AddEventListenerOptions): void
      removeEventListener(t: string, fn: (e: GestureLike) => void): void
    }
    for (const [name, fn] of [['gesturestart', onStart], ['gesturechange', onChange], ['gestureend', onEnd]] as const) {
      host.addEventListener(name, fn, { passive: false })
      this.cleanups.push(() => host.removeEventListener(name, fn))
    }
  }

  private bindPointer(): void {
    const isBackground = this.opts.isBackground
      ?? ((target: EventTarget | null) => target === this.host || target === this.world)

    const onDown = (e: PointerEvent) => {
      if (!(e.button === 1 || (e.button === 0 && isBackground(e.target)))) return
      e.preventDefault()
      this.host.setPointerCapture(e.pointerId)
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY }
      this.host.style.cursor = 'grabbing'
    }
    const onMove = (e: PointerEvent) => {
      if (!this.drag || e.pointerId !== this.drag.id) return
      this.panBy(e.clientX - this.drag.x, e.clientY - this.drag.y)
      this.drag.x = e.clientX
      this.drag.y = e.clientY
    }
    const onUp = (e: PointerEvent) => {
      if (!this.drag || e.pointerId !== this.drag.id) return
      if (this.host.hasPointerCapture(e.pointerId)) this.host.releasePointerCapture(e.pointerId)
      this.drag = null
      this.host.style.cursor = ''
    }

    this.host.addEventListener('pointerdown', onDown)
    this.host.addEventListener('pointermove', onMove)
    this.host.addEventListener('pointerup', onUp)
    this.host.addEventListener('pointercancel', onUp)
    this.cleanups.push(() => {
      this.host.removeEventListener('pointerdown', onDown)
      this.host.removeEventListener('pointermove', onMove)
      this.host.removeEventListener('pointerup', onUp)
      this.host.removeEventListener('pointercancel', onUp)
    })
  }
}
