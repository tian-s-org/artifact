import { useCallback, useMemo, useState } from 'react'
import { IframeCanvas } from '../canvas/IframeCanvas'
import { FocusOverlay } from '../canvas/FocusOverlay'
import type { BoardView } from '../canvas/types'
import { boardsToViews, useProject } from '../store/project-store'
import { VersionPanel } from './VersionPanel'

interface Props {
  projectId: string
}

/** 底部一条：断线、写回失败都在这里说，不遮挡画布 */
const NOTICE = 'notice fixed bottom-16 left-1/2 z-210 flex max-w-[min(560px,calc(100vw_-_32px))] -translate-x-1/2 items-center gap-10 rounded-[9px] py-7 pr-8 pl-12 text-[12.5px]'

export function CanvasPage({ projectId }: Props) {
  const { store, state } = useProject(projectId)
  const boards = useMemo(
    () => boardsToViews(projectId, state.canvas, state.meta, state.filesBase),
    [projectId, state.canvas, state.meta, state.filesBase],
  )
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [versionsOpen, setVersionsOpen] = useState(false)

  const focused = boards.find((b) => b.id === focusedId) ?? null

  const move = useCallback(
    (id: string, x: number, y: number) => {
      void store.moveBoard(id, x, y)
    },
    [store],
  )

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
    return (
      <div className="screen-note fixed inset-0 flex flex-col items-center justify-center gap-8 p-24 text-center text-ink-2">
        正在读取 {projectId} …
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="screen-note fixed inset-0 flex flex-col items-center justify-center gap-8 p-24 text-center text-ink-2">
        <b className="text-[14px] text-ink">打不开项目「{projectId}」</b>
        <span>{state.error?.message ?? '未知错误'}</span>
        <a className="text-accent no-underline" href="/">
          回到项目列表
        </a>
      </div>
    )
  }

  return (
    <>
      <IframeCanvas
        projectId={projectId}
        boards={boards}
        onMove={move}
        onOpen={open}
        onOpenVersions={() => setVersionsOpen((open) => !open)}
        overlayOpen={focused !== null}
      />

      {/* 左上角只有一个返回入口，不做侧栏；聚焦层盖上来时让开 */}
      <div
        className={`project-head fixed top-14 left-16 z-200 flex items-baseline gap-10 rounded-[10px] bg-white/88 py-6 pr-10 pl-6 text-[12.5px] shadow-[0_1px_2px_rgba(0,0,0,.08),0_8px_24px_rgba(0,0,0,.1)] backdrop-blur-[20px] backdrop-saturate-[160%] ${
          focused ? 'invisible' : ''
        }`}
      >
        <a
          href="/"
          className="project-back rounded-[6px] px-7 py-2 text-ink-2 no-underline hover:bg-black/6 hover:text-ink"
        >
          项目
        </a>
        <span className="project-name font-semibold text-ink">{state.canvas?.name ?? projectId}</span>
        <span className="project-id font-mono text-[11px] text-ink-3">{projectId}</span>
      </div>

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
      {!state.connected && state.status === 'ready' && (
        <div
          className={`${NOTICE} bg-white/90 text-ink-2 shadow-[0_0_0_1px_var(--color-line),0_8px_24px_rgba(0,0,0,.08)]`}
        >
          连接已断开，正在重连…
        </div>
      )}

      {focused && <FocusOverlay board={focused} onClose={() => setFocusedId(null)} onStep={step} />}

      {versionsOpen && (
        <VersionPanel
          projectId={projectId}
          tick={state.versionTick}
          boards={boards}
          onClose={() => setVersionsOpen(false)}
        />
      )}
    </>
  )
}
