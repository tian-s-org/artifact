import { useRef, useState } from 'react'
import type { BoardView } from './types'

interface Props {
  board: BoardView
  onCommit: (id: string, x: number, y: number) => void
  onFocus: (board: BoardView) => void
}

/** 一块画板：标签 + iframe。iframe 不接指针事件，拖拽、双击都落在这一层。
 *  拖动只在超过 4px 后才算数，避免一次点击把画板挪偏。 */
export function BoardFrame({ board, onCommit, onFocus }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    pointerId: number
    startX: number
    startY: number
    x0: number
    y0: number
    scale: number
    moved: boolean
  } | null>(null)
  const [dragging, setDragging] = useState(false)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const el = wrapRef.current
    if (!el) return
    const scale = el.getBoundingClientRect().width / board.width || 1
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x0: board.x,
      y0: board.y,
      scale,
      moved: false,
    }
    el.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    const el = wrapRef.current
    if (!el) return
    if (!d.moved) {
      d.moved = true
      setDragging(true)
    }
    el.style.left = `${d.x0 + dx / d.scale}px`
    el.style.top = `${d.y0 + dy / d.scale}px`
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    drag.current = null
    setDragging(false)
    const el = wrapRef.current
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    if (!d.moved || !el) return
    const x = parseFloat(el.style.left)
    const y = parseFloat(el.style.top)
    if (Number.isFinite(x) && Number.isFinite(y)) onCommit(board.id, Math.round(x), Math.round(y))
  }

  return (
    <div
      ref={wrapRef}
      className={`board${dragging ? ' is-dragging' : ''}`}
      style={{ left: board.x, top: board.y, width: board.width, height: board.height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onFocus(board)}
    >
      <span className="board-label">
        <span className="board-id">{board.id}</span>
        <span>{board.name}</span>
      </span>
      <div className="board-frame">
        {board.missing ? (
          <div className="board-missing">
            <b>找不到画板文件</b>
            <span>{board.id} 已登记在 canvas.json 里，但 artboards/{board.id}/index.html 不存在</span>
          </div>
        ) : (
          <iframe
            title={board.name}
            src={board.src}
            sandbox=""
            loading="eager"
            referrerPolicy="no-referrer"
          />
        )}
      </div>
    </div>
  )
}
