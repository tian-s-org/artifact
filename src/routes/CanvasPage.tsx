import { useCallback, useMemo, useState } from 'react'
import { IframeCanvas } from '../canvas/IframeCanvas'
import { FocusOverlay } from '../canvas/FocusOverlay'
import type { BoardView } from '../canvas/types'
import { boardsToViews, useProject } from '../store/project-store'

/** 底部一条：断线、读不到都在这里说，不遮挡画布 */
const NOTICE =
  'notice fixed bottom-16 left-1/2 z-210 flex max-w-[min(560px,calc(100vw_-_32px))] -translate-x-1/2 items-center gap-10 rounded-[9px] py-7 pr-8 pl-12 text-[12.5px]'

const SCREEN_NOTE =
  'screen-note fixed inset-0 flex flex-col items-center justify-center gap-8 p-24 text-center text-ink-2'

export function CanvasPage() {
  const { store, state } = useProject()
  const boards = useMemo(
    () => boardsToViews(state.layout, state.meta, state.filesBase),
    [state.layout, state.meta, state.filesBase],
  )
  const [focusedId, setFocusedId] = useState<string | null>(null)
  // 悬停显示尺寸：纯展示开关，记在本机
  const [showSpecs, setShowSpecs] = useState(() => {
    try {
      return window.localStorage.getItem('artifact:specs') === '1'
    } catch {
      return false
    }
  })

  const toggleSpecs = useCallback(() => {
    setShowSpecs((value) => {
      const next = !value
      try {
        window.localStorage.setItem('artifact:specs', next ? '1' : '0')
      } catch {
        // 隐私模式下存不了，不影响本次会话
      }
      return next
    })
  }, [])

  const focused = boards.find((b) => b.id === focusedId) ?? null
  const open = useCallback((board: BoardView) => setFocusedId(board.id), [])
  const step = useCallback(
    (delta: number) => {
      setFocusedId((current) => {
        if (!current) return current
        const index = boards.findIndex((b) => b.id === current)
        const next = boards[(index + delta + boards.length) % boards.length]
        return next?.id ?? current
      })
    },
    [boards],
  )

  if (state.status === 'loading') {
    return <div className={SCREEN_NOTE}>正在读取画布 …</div>
  }

  if (state.status === 'error') {
    return (
      <div className={SCREEN_NOTE}>
        <b className="text-[14px] text-ink">打不开画布</b>
        <span>{state.error?.message ?? '未知错误'}</span>
        <button
          type="button"
          className="cursor-pointer rounded-[6px] bg-black/7 px-10 py-3"
          onClick={() => void store.load()}
        >
          重试
        </button>
      </div>
    )
  }

  return (
    <>
      <IframeCanvas
        boards={boards}
        onOpen={open}
        overlayOpen={focused !== null}
        showSpecs={showSpecs}
        onToggleSpecs={toggleSpecs}
      />

      {/* 左上角只有画布名字；聚焦层盖上来时让开 */}
      <div
        className={`project-head fixed top-14 left-16 z-200 flex items-baseline gap-10 rounded-[10px] bg-white/88 py-6 pr-10 pl-10 text-[12.5px] shadow-[0_1px_2px_rgba(0,0,0,.08),0_8px_24px_rgba(0,0,0,.1)] backdrop-blur-[20px] backdrop-saturate-[160%] ${
          focused ? 'invisible' : ''
        }`}
      >
        <span className="project-name font-semibold text-ink">{state.layout?.name ?? '未命名画布'}</span>
      </div>

      {state.status === 'ready' && boards.length === 0 && (
        <div className={`${SCREEN_NOTE} pointer-events-none`}>
          <b className="text-[14px] text-ink">画布还是空的</b>
          <span>在本地写好 .artifact/，然后 artifact push</span>
        </div>
      )}

      {state.error && (
        <div
          className={`${NOTICE} bg-[#fdf6e7] text-[#8a5a12] shadow-[0_0_0_1px_rgba(180,83,9,.16),0_8px_24px_rgba(0,0,0,.1)]`}
        >
          {state.error.message}
          <button
            type="button"
            className="cursor-pointer rounded-[6px] bg-black/7 px-8 py-2"
            onClick={() => void store.load()}
          >
            重试
          </button>
        </div>
      )}
      {!state.connected && state.layout && (
        <div
          className={`${NOTICE} bg-white/90 text-ink-2 shadow-[0_0_0_1px_var(--color-line),0_8px_24px_rgba(0,0,0,.08)]`}
        >
          连不上画布服务，正在重试…
        </div>
      )}

      {focused && <FocusOverlay board={focused} onClose={() => setFocusedId(null)} onStep={step} />}
    </>
  )
}
