import { useCallback, useMemo, useState } from 'react'
import { IframeCanvas } from '../canvas/IframeCanvas'
import { FocusOverlay } from '../canvas/FocusOverlay'
import type { BoardView } from '../canvas/types'
import { boardsToViews, useProject } from '../store/project-store'
import { VersionPanel } from './VersionPanel'

interface Props {
  projectId: string
}

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
    return <div className="screen-note">正在读取 {projectId} …</div>
  }

  if (state.status === 'error') {
    return (
      <div className="screen-note">
        <b>打不开项目「{projectId}」</b>
        <span>{state.error?.message ?? '未知错误'}</span>
        <a href="/">回到项目列表</a>
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
      />

      <div className="project-head">
        <a href="/" className="project-back">
          项目
        </a>
        <span className="project-name">{state.canvas?.name ?? projectId}</span>
        <span className="project-id">{projectId}</span>
      </div>

      {state.error && (
        <div className="notice">
          {state.error.message}
          <button type="button" onClick={() => void store.load()}>
            重试
          </button>
        </div>
      )}
      {!state.connected && state.status === 'ready' && (
        <div className="notice is-quiet">连接已断开，正在重连…</div>
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
