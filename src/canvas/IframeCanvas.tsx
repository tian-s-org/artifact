import { useCallback, useEffect, useRef, useState } from 'react'
import { Viewport, type Rect } from '@tian-s-org/canvas-core'
import { BoardFrame } from './BoardFrame'
import { readDeepLink } from './deep-link'
import type { BoardView } from './types'

interface Props {
  boards: BoardView[]
  onOpen: (board: BoardView) => void
  /** 聚焦层盖上来时，工具条让开，免得两排字叠在一起 */
  overlayOpen: boolean
  /** 「尺寸」开关：打开后悬停画框显示设计尺寸 */
  showSpecs: boolean
  onToggleSpecs: () => void
}

const FIT_PADDING = 80
const VIEW_KEY = 'artifact:view'

/** 工具条上的按钮长得一样，尺寸写一份 */
const TOOL_BUTTON = 'h-24 cursor-pointer rounded-[6px] px-9 text-[#3c3c3c] hover:bg-black/6'

function rects(boards: BoardView[]): Rect[] {
  return boards.map((b) => ({ x: b.x, y: b.y, width: b.width, height: b.height }))
}

/** 首次进画布的视角，优先级：深链 → 上次的视口 → 取景全部画板。 */
function applyInitialView(vp: Viewport, boards: BoardView[]): boolean {
  const deep = readDeepLink(window.location.search, boards)
  if (deep?.rect) {
    if (deep.scale === null) vp.fitToRect(deep.rect, { padding: FIT_PADDING, maxScale: 1 })
    else vp.centerRect(deep.rect, deep.scale)
    return true
  }
  if (deep) {
    if (boards.length > 0) vp.fitToRects(rects(boards), { padding: FIT_PADDING, maxScale: 1 })
    if (deep.scale !== null) vp.setScaleOriginTo(deep.scale)
    return true
  }
  if (vp.restoreView()) return true
  if (boards.length === 0) return false
  vp.fitToRects(rects(boards), { padding: FIT_PADDING, maxScale: 1 })
  return true
}

export function IframeCanvas({ boards, onOpen, overlayOpen, showSpecs, onToggleSpecs }: Props) {
  /* 按住 ⌥ 才把指针让进画框：平时要留着力气拖画布 */
  const [altDown, setAltDown] = useState(false)
  const hostRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const pctRef = useRef<HTMLSpanElement>(null)
  const vpRef = useRef<Viewport | null>(null)
  const fittedRef = useRef(false)
  const boardsRef = useRef(boards)
  boardsRef.current = boards

  useEffect(() => {
    const host = hostRef.current
    const world = worldRef.current
    if (!host || !world) return

    const vp = new Viewport(host, world, {
      gridSize: 24,
      persistKey: VIEW_KEY,
      isBackground: (target) => target === host || target === world,
      onChange: (t) => {
        if (pctRef.current) pctRef.current.textContent = `${Math.round(t.scale * 100)}%`
        // 画框标签反向缩放，屏幕上保持固定字号（Figma 同款）
        world.style.setProperty('--label-scale', String(1 / t.scale))
      },
    })
    vp.attach()
    vpRef.current = vp

    const timer = setTimeout(() => {
      vp.resetIfNothingVisible([...world.querySelectorAll('.board')])
    }, 300)

    return () => {
      clearTimeout(timer)
      vp.destroy()
      vpRef.current = null
    }
  }, [])

  /* 画板是异步加载的：第一帧可能是空的，等它们到了再做首次取景 */
  useEffect(() => {
    if (fittedRef.current || boards.length === 0) return
    const vp = vpRef.current
    if (!vp) return
    fittedRef.current = true
    applyInitialView(vp, boards)
    worldRef.current?.style.setProperty('--label-scale', String(1 / vp.transform.scale))
  }, [boards])

  const fit = useCallback(() => {
    vpRef.current?.fitToRects(rects(boardsRef.current), { padding: FIT_PADDING, maxScale: 1 })
  }, [])

  useEffect(() => {
    const sync = (e: KeyboardEvent) => setAltDown(e.altKey)
    const clear = () => setAltDown(false)
    window.addEventListener('keydown', sync)
    window.addEventListener('keyup', sync)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', sync)
      window.removeEventListener('keyup', sync)
      window.removeEventListener('blur', clear)
    }
  }, [])

  return (
    <>
      {/* 网格由 canvas-core 直接写到 background 上，这里只管铺满屏幕 */}
      <div ref={hostRef} className="canvas-host fixed inset-0 touch-none overflow-hidden overscroll-none">
        <div ref={worldRef} className="canvas-world absolute top-0 left-0 origin-top-left">
          {boards.map((board) => (
            <BoardFrame
              key={board.id}
              board={board}
              onFocus={onOpen}
              showSpecs={showSpecs}
              interactive={altDown}
            />
          ))}
        </div>
      </div>

      {/* 工具条固定在视口里，不跟画布缩放 */}
      <div
        className={`canvas-tools fixed bottom-16 left-16 z-200 flex items-center gap-4 rounded-[10px] bg-white/88 p-5 shadow-[0_1px_2px_rgba(0,0,0,.1),0_8px_24px_rgba(0,0,0,.12)] backdrop-blur-[20px] backdrop-saturate-[160%] ${
          overlayOpen ? 'invisible' : ''
        }`}
      >
        <span className="tool-hint px-6 text-[rgba(60,60,60,.55)]">拖拽平移 · 滚轮缩放 · 双击画框放大</span>
        <span className="tool-sep h-16 w-px bg-black/12" />
        <button
          type="button"
          className={`${TOOL_BUTTON} ${showSpecs ? 'bg-black/6 text-ink' : ''}`}
          aria-pressed={showSpecs}
          title="悬停画框时显示尺寸（类似 Figma）"
          onClick={onToggleSpecs}
        >
          尺寸
        </button>
        <button type="button" className={TOOL_BUTTON} onClick={fit}>
          适应窗口
        </button>
        <button type="button" className={TOOL_BUTTON} onClick={() => vpRef.current?.setScaleOriginTo(1)}>
          100%
        </button>
        <span
          ref={pctRef}
          className="tool-pct min-w-[44px] pr-6 pl-2 text-right font-mono text-[11.5px] tabular-nums text-[rgba(60,60,60,.7)]"
        >
          100%
        </span>
      </div>
    </>
  )
}
