import { useCallback, useEffect, useState } from 'react'
import { fetchVersions, restoreVersion, saveVersion, type VersionSummary } from '../api/client'
import type { BoardView } from '../canvas/types'

interface Props {
  projectId: string
  /** store 里的版本计数：保存/恢复成功后 SSE 也会推一次 */
  tick: number
  boards: BoardView[]
  onClose: () => void
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 版本历史：保存当前状态、整版恢复、只恢复单块画板。恢复前服务端会自动留备份。 */
export function VersionPanel({ projectId, tick, boards, onClose }: Props) {
  const [versions, setVersions] = useState<VersionSummary[] | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const data = await fetchVersions(projectId)
      setVersions(data.versions)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [projectId])

  useEffect(() => {
    void refresh()
  }, [refresh, tick])

  const save = async () => {
    setBusy('save')
    setError(null)
    try {
      const { version } = await saveVersion(projectId, note)
      setNote('')
      setFlash(`已保存 ${version.id}`)
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const restore = async (versionId: string, boardId?: string) => {
    setBusy(`${versionId}:${boardId ?? 'all'}`)
    setError(null)
    try {
      const result = await restoreVersion(projectId, versionId, boardId)
      setFlash(
        boardId
          ? `已恢复 ${versionId} 的 ${boardId}，只动了这一块`
          : `已恢复 ${versionId}（${result.restored.length} 块画板）`,
      )
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const nameOf = (boardId: string) => boards.find((b) => b.id === boardId)?.name ?? boardId

  return (
    <aside className="version-panel">
      <div className="vp-head">
        <span className="vp-title">版本</span>
        <button type="button" className="vp-close" onClick={onClose} title="关闭">
          ✕
        </button>
      </div>

      <div className="vp-save">
        <input
          className="vp-note"
          value={note}
          placeholder="这一版是什么（可留空）"
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && busy === null) void save()
          }}
        />
        <button type="button" className="vp-btn" disabled={busy !== null} onClick={() => void save()}>
          {busy === 'save' ? '保存中…' : '保存当前'}
        </button>
      </div>

      {flash && <div className="vp-flash">{flash}</div>}
      {error && <div className="vp-error">{error}</div>}

      <div className="vp-list">
        {versions === null && <div className="vp-empty">读取中…</div>}
        {versions?.length === 0 && <div className="vp-empty">还没有版本。先「保存当前」留个底。</div>}
        {versions?.map((version) => {
          const boardIds = Object.keys(version.boards)
          return (
            <div className="vp-item" key={version.id}>
              <div className="vp-meta">
                <span className="vp-id">{version.id}</span>
                <span className="vp-time">{formatTime(version.at)}</span>
                <button
                  type="button"
                  className="vp-btn"
                  disabled={busy !== null}
                  onClick={() => void restore(version.id)}
                  title="整版恢复（恢复前自动备份当前状态）"
                >
                  {busy === `${version.id}:all` ? '恢复中…' : '恢复'}
                </button>
              </div>
              <div className="vp-note-text">
                {version.note}
                {version.auto && <span className="vp-tag">自动</span>}
              </div>
              <div className="vp-boards">
                {boardIds.map((boardId) => (
                  <button
                    type="button"
                    key={boardId}
                    className="vp-board"
                    disabled={busy !== null}
                    onClick={() => void restore(version.id, boardId)}
                    title="只恢复这一块画板，其他画板不动"
                  >
                    <span className="vp-board-id">{boardId}</span>
                    <span>{nameOf(boardId)}</span>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
