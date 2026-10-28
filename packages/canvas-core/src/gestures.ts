/* 滚轮语义判定：同一个滚轮事件在不同设备上意味着完全不同的事。
   物理滚轮 = 缩放；触控板两指 = 平移；触控板捏合（ctrlKey）= 缩放。 */

/** 每次滚轮点击的缩放步长：10%。0.18（约 20%）两下就翻倍，太猛。 */
export const WHEEL_ZOOM_STEP = Math.log(1.1)

/** 手势突发窗口：手指抬起后的惯性尾巴会被并进同一串，不会被当成连续点击。 */
export const WHEEL_BURST_MS = 200

/** 物理滚轮发的是行模式（Firefox）或整百整百的整数像素、没有横向分量（Chrome/Safari）；
 *  触控板两指是小而带小数的像素，常有横向分量。 */
export function isMouseWheel(e: WheelEvent): boolean {
  return (
    e.deltaMode !== 0 ||
    (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40)
  )
}

export type WheelAction = 'pinch' | 'step' | 'pan'

/** 每串滚轮只在开始时判定一次是否属于「滚轮点击」，整串沿用。
 *  逐个判定会把触控板的惯性尾巴（整数 deltaY ≥ 40、无横向）读成一串滚轮点击，
 *  每一帧都跳一格缩放。锁存只会降级：开串是平移就一直是平移。 */
export class WheelClassifier {
  private zooms = false
  private lastAt = -Infinity

  classify(e: WheelEvent): WheelAction {
    const mod = e.ctrlKey || e.metaKey
    if (mod) {
      // 修饰键的滚轮永远缩放，且不在同一串里；下一串普通滚轮重新判定
      this.lastAt = -Infinity
      return isMouseWheel(e) ? 'step' : 'pinch'
    }
    const now = typeof performance === 'undefined' ? Date.now() : performance.now()
    if (now - this.lastAt > WHEEL_BURST_MS) this.zooms = isMouseWheel(e)
    this.lastAt = now
    return this.zooms ? 'step' : 'pan'
  }

  reset(): void {
    this.lastAt = -Infinity
  }
}
