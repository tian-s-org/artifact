import { useEffect, useState } from 'react'
import type { BoardView } from './types'

interface Props {
  board: BoardView
  onClose: () => void
  onStep: (delta: number) => void
}

const BODY = 'text-[13px]'
const ID = 'focus-id font-mono text-[11.5px]'

/** 聚焦层：同一份设计文件按视口大小重新渲染，不是位图放大。
 *  全屏时只留这一块画板，画布和工具条都不在，顶上只剩一条查看器横栏。 */
export function FocusOverlay({ board, onClose, onStep }: Props) {
  const [scale, setScale] = useState(1)
  const [full, setFull] = useState(false)

  useEffect(() => {
    const fit = () => {
      const s = full
        ? Math.min((window.innerWidth - 48) / board.width, (window.innerHeight - 45 - 48) / board.height, 2)
        : Math.min((window.innerWidth - 160) / board.width, (window.innerHeight - 180) / board.height, 2)
      setScale(Math.max(0.1, s))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [board.width, board.height, full])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // 全屏里 Esc 先退回聚焦层，再按一次才关掉
        if (full) setFull(false)
        else onClose()
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') onStep(1)
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') onStep(-1)
      else if (e.key === 'f' || e.key === 'F') setFull((v) => !v)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [full, onClose, onStep])

  return (
    <div
      className={`focus-layer fixed inset-0 z-300 grid place-items-center ${
        full ? 'bg-canvas p-[45px_24px_24px]' : 'bg-black/55 p-40'
      }`}
      onClick={full ? undefined : onClose}
    >
      {full ? (
        <div className="viewer-bar absolute inset-x-0 top-0 z-10 flex h-45 items-center justify-between border-b border-line bg-surface pr-8 pl-20 text-ink" onClick={(e) => e.stopPropagation()}>
          <div className={`viewer-title flex items-baseline gap-10 ${BODY}`}>
            <span className={`${ID} text-ink-3`}>{board.id}</span>
            <span>{board.name}</span>
          </div>
          <div className="viewer-actions flex gap-2">
            <button
              type="button"
              className="h-28 min-w-[28px] cursor-pointer rounded-[8px] px-9 text-[12.5px] hover:bg-black/6"
              onClick={() => setFull(false)}
            >
              还原
            </button>
            <button
              type="button"
              className="h-28 min-w-[28px] cursor-pointer rounded-[8px] px-0 text-[12.5px] text-ink-2 hover:bg-black/6"
              aria-label="关闭"
              onClick={onClose}
            >
              ✕
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className={`focus-head absolute top-18 left-26 flex items-baseline gap-10 text-white/90 ${BODY}`}>
            <span className={`${ID} text-white/55`}>{board.id}</span>
            <span>{board.name}</span>
          </div>
          <button
            type="button"
            className="focus-expand absolute top-14 right-18 h-28 cursor-pointer rounded-[8px] bg-white/12 px-10 text-[12.5px] text-white/90 hover:bg-white/20"
            onClick={(e) => {
              e.stopPropagation()
              setFull(true)
            }}
          >
            全屏
          </button>
        </>
      )}

      <div
        className={`focus-stage overflow-hidden bg-white ${
          full
            ? 'shadow-[0_0_0_1px_rgba(0,0,0,.07),0_6px_18px_rgba(0,0,0,.09)]'
            : 'shadow-[0_0_0_1px_rgba(255,255,255,.12),0_30px_80px_rgba(0,0,0,.45)]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 聚焦层里画板是唯一的东西，指针直接给进去，:hover 这些交互态才看得到 */}
        <iframe
          className="block"
          title={board.name}
          src={board.src}
          sandbox=""
          referrerPolicy="no-referrer"
          style={{ width: board.width, height: board.height, zoom: scale }}
        />
      </div>

      <div
        className={`focus-hint absolute bottom-20 left-1/2 -translate-x-1/2 text-[12px] ${
          full ? 'text-ink-3' : 'text-white/60'
        }`}
      >
        {full ? 'Esc 退出全屏 · ←/→ 切换画板' : 'Esc 退出 · ←/→ 切换画板 · F 全屏'}
      </div>
    </div>
  )
}
