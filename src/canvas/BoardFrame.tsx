import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { BoardView } from './types'

/** 新一版画板加载好之后，用多久淡入（旧的那一帧还留在下面） */
const FADE_MS = 120

interface Props {
  board: BoardView
  onFocus: (board: BoardView) => void
  /** 工具栏的「尺寸」开关：打开后悬停显示设计尺寸 */
  showSpecs: boolean
  /** 按住 ⌥ 时把指针让给画框内部，:hover 之类的交互态才看得到 */
  interactive?: boolean
}

/** 一块画框：标签 + iframe。画布只读，默认 iframe 不接指针事件（不然拖动画布会被吃掉），
 *  按住 ⌥ 或进聚焦层才把指针让进去。 */

/** 名称自带编号（1.1 / 2. / 03）时，画布不再补自己的两位序号，免得「01 1.1 设计系统」叠两层 */
const OWN_NUMBER = /^\s*\d+([.、]\d*)*\s*/
/** 标签反向缩放：外层世界 zoom 是 s，标签乘 1/s，屏幕上始终 12.5px */
const labelScale: CSSProperties = {
  transform: 'scale(var(--label-scale, 1))',
  transformOrigin: 'left bottom',
}

export function BoardFrame({ board, onFocus, showSpecs, interactive = false }: Props) {
  const [hovered, setHovered] = useState(false)
  const indexText = String(board.index).padStart(2, '0')
  const showIndex = !OWN_NUMBER.test(board.name)

  /* 换帧：src 变了先挂一张新 iframe 在旧帧上面，等它 load 完淡入，再撤掉旧的。
     直接换 src 会白闪一下——旧文件先被清掉，新文件才画出来。 */
  const [shownSrc, setShownSrc] = useState(board.src)
  const [incomingSrc, setIncomingSrc] = useState<string | null>(null)
  const [fadingIn, setFadingIn] = useState(false)
  const fadeTimer = useRef<number | null>(null)

  useEffect(() => {
    if (board.src === shownSrc) return
    setFadingIn(false)
    setIncomingSrc(board.src)
  }, [board.src, shownSrc])

  useEffect(
    () => () => {
      if (fadeTimer.current !== null) window.clearTimeout(fadeTimer.current)
    },
    [],
  )

  const commitIncoming = () => {
    const next = incomingSrc
    if (next === null) return
    setFadingIn(true)
    if (fadeTimer.current !== null) window.clearTimeout(fadeTimer.current)
    fadeTimer.current = window.setTimeout(() => {
      setShownSrc(next)
      setIncomingSrc(null)
      setFadingIn(false)
    }, FADE_MS)
  }

  return (
    <div
      className="board absolute cursor-default"
      style={{ left: board.x, top: board.y, width: board.width, height: board.height }}
      onDoubleClick={() => onFocus(board)}
      onPointerEnter={(e) => {
        // 按住左键是在拖画布，别弹提示
        if (e.buttons === 0) setHovered(true)
      }}
      onPointerLeave={() => setHovered(false)}
    >
      {/* 标签固定屏幕字号：跟着画布缩放会反向缩，Figma 同款做法 */}
      {showSpecs && hovered ? (
        <span
          className="board-spec pointer-events-none absolute bottom-[calc(100%_+_6px)] left-0 rounded-[4px] bg-accent px-7 py-4 text-[12px] leading-none whitespace-nowrap text-white select-none"
          style={labelScale}
        >
          {showIndex ? `${indexText} ` : ''}{board.name} · {board.width} × {board.height}
        </span>
      ) : (
        <span
          className="board-label pointer-events-none absolute bottom-[calc(100%_+_6px)] left-[-4px] flex items-baseline gap-8 text-[12.5px] leading-none whitespace-nowrap text-ink-2 select-none"
          style={labelScale}
        >
          {showIndex && <span className="board-index font-mono text-[11.5px] text-ink-3">{indexText}</span>}
          <span>{board.name}</span>
        </span>
      )}
      <div className="board-frame relative h-full w-full overflow-hidden bg-surface shadow-[0_0_0_1px_rgba(0,0,0,.07),0_6px_18px_rgba(0,0,0,.09)]">
        {board.missing ? (
          <div className="board-missing flex h-full flex-col items-center justify-center gap-6 bg-[repeating-linear-gradient(-45deg,#fafafa,#fafafa_10px,#f2f2f2_10px,#f2f2f2_20px)] p-24 text-center text-ink-2">
            <b className="font-semibold text-ink">找不到画板文件</b>
            <span className="max-w-[460px] text-[12px] leading-[1.6]">
              {board.id} 已登记在 layout.json 里，但 artboards/{board.id}/index.html 不存在
            </span>
          </div>
        ) : (
          <>
            <iframe
              className={`board-doc absolute inset-0 block h-full w-full bg-white ${interactive ? 'pointer-events-auto' : 'pointer-events-none'}`}
              title={board.name}
              src={shownSrc}
              sandbox=""
              loading="eager"
              referrerPolicy="no-referrer"
            />
            {incomingSrc !== null && (
              <iframe
                key={incomingSrc}
                className={`board-doc absolute inset-0 block h-full w-full bg-white transition-opacity duration-[120ms] ease-out ${
                  interactive ? 'pointer-events-auto' : 'pointer-events-none'
                } ${
                  fadingIn ? 'opacity-100' : 'opacity-0'
                }`}
                title={board.name}
                src={incomingSrc}
                sandbox=""
                loading="eager"
                referrerPolicy="no-referrer"
                onLoad={commitIncoming}
              />
            )}
          </>
        )}

        {showSpecs && hovered && (
          <span className="pointer-events-none absolute inset-0 ring-1 ring-accent ring-inset" aria-hidden />
        )}
      </div>
    </div>
  )
}
