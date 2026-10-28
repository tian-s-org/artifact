import { useEffect, useState } from 'react'
import type { BoardView } from './types'

interface Props {
  board: BoardView
  onClose: () => void
  onStep: (delta: number) => void
}

/** 双击后的放大视图：同一份设计文件按视口大小重新渲染，不是位图放大。 */
export function FocusOverlay({ board, onClose, onStep }: Props) {
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const fit = () => {
      const s = Math.min(
        (window.innerWidth - 160) / board.width,
        (window.innerHeight - 180) / board.height,
        2,
      )
      setScale(Math.max(0.1, s))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [board.width, board.height])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') onStep(1)
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') onStep(-1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onStep])

  return (
    <div className="focus-layer" onClick={onClose}>
      <div className="focus-head">
        <span className="focus-id">{board.id}</span>
        <span>{board.name}</span>
      </div>
      <div className="focus-stage" onClick={(e) => e.stopPropagation()}>
        <iframe
          title={board.name}
          src={board.src}
          sandbox=""
          referrerPolicy="no-referrer"
          style={{ width: board.width, height: board.height, zoom: scale }}
        />
      </div>
      <div className="focus-hint">Esc 退出 · ←/→ 切换画板</div>
    </div>
  )
}
