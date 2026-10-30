import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { Rect, Transform } from '@tian-s-org/canvas-core'
import type { BoardView } from './types'

interface Props {
  boards: BoardView[]
  view: Transform
  host: { width: number; height: number }
  /** 把这个世界坐标点挪到视口正中 */
  onJump: (x: number, y: number) => void
}

/** 缩略图自己的尺寸，跟画布内容无关 */
const W = 196
const H = 132
const PAD = 8

function boundsOf(rects: Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, width: 1, height: 1 }
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const r of rects) {
    x0 = Math.min(x0, r.x)
    y0 = Math.min(y0, r.y)
    x1 = Math.max(x1, r.x + r.width)
    y1 = Math.max(y1, r.y + r.height)
  }
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) }
}

/** 画布全貌的缩略图：画板是灰块，视口是一个白框，拖它就能换镜头。
 *  比「适应窗口」多一层：不只看得到全部，还能直接挑看哪里。 */
export function Minimap({ boards, view, host, onJump }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  const world = boundsOf(boards.map((b) => ({ x: b.x, y: b.y, width: b.width, height: b.height })))

  // 视野可能比全部画板还大：算比例时把视野也框进去，缩略图才不会把白框的画到外面
  const visible: Rect = host.width > 0 && view.scale > 0
    ? { x: -view.x / view.scale, y: -view.y / view.scale, width: host.width / view.scale, height: host.height / view.scale }
    : { x: world.x, y: world.y, width: world.width, height: world.height }
  const outer = boundsOf([
    { x: world.x, y: world.y, width: world.width, height: world.height },
    visible,
  ])

  const k = Math.min((W - PAD * 2) / outer.width, (H - PAD * 2) / outer.height)
  const ox = PAD + (W - PAD * 2 - outer.width * k) / 2 - outer.x * k
  const oy = PAD + (H - PAD * 2 - outer.height * k) / 2 - outer.y * k

  const toMini = (r: Rect) => ({
    left: r.x * k + ox,
    top: r.y * k + oy,
    width: Math.max(1, r.width * k),
    height: Math.max(1, r.height * k),
  })

  const toWorld = (clientX: number, clientY: number) => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return null
    return { x: (clientX - box.left - ox) / k, y: (clientY - box.top - oy) / k }
  }

  const drag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const point = toWorld(e.clientX, e.clientY)
    if (point) onJump(point.x, point.y)
  }

  return (
    <div
      ref={ref}
      className="canvas-minimap pointer-events-auto relative shrink-0 cursor-grab overflow-hidden rounded-[8px] bg-black/6 active:cursor-grabbing"
      style={{ width: W, height: H }}
      onPointerDown={(e) => {
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          // 合成的指针事件拿不到捕获权，照常拖就行
        }
        drag(e)
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) drag(e)
      }}
      title="拖拽换镜头"
    >
      {boards.map((b) => (
        <div
          key={b.id}
          className="absolute rounded-[1.5px] bg-[rgba(0,0,0,.16)]"
          style={toMini({ x: b.x, y: b.y, width: b.width, height: b.height })}
        />
      ))}
      <div
        className="pointer-events-none absolute rounded-[2px] border border-[rgba(0,0,0,.55)] bg-white/35"
        style={toMini(visible)}
      />
    </div>
  )
}
