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

/** 版本条目里的「恢复」：比保存按钮小一号，用浅底 */
const ITEM_BUTTON =
  'vp-btn h-22 cursor-pointer rounded-[7px] bg-black/6 px-7 text-[11.5px] text-ink-2 enabled:hover:bg-black/11 enabled:hover:text-ink disabled:cursor-default disabled:opacity-50'

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
    <aside className="version-panel fixed top-14 right-16 bottom-16 z-220 flex w-[min(320px,calc(100vw_-_32px))] flex-col rounded-[12px] bg-white/92 text-[12.5px] shadow-[0_0_0_1px_var(--color-line),0_8px_30px_rgba(0,0,0,.14)] backdrop-blur-[20px] backdrop-saturate-[160%]">
      <div className="vp-head flex items-center justify-between pt-9 pr-8 pb-7 pl-12">
        <span className="vp-title font-semibold text-ink">版本</span>
        <button
          type="button"
          className="vp-close h-22 w-22 cursor-pointer rounded-[6px] leading-none text-ink-3 hover:bg-black/6 hover:text-ink"
          onClick={onClose}
          title="关闭"
        >
          ✕
        </button>
      </div>

      <div className="vp-save flex gap-6 px-10 pb-8">
        <input
          className="vp-note h-26 min-w-0 flex-1 rounded-[7px] bg-black/5 px-8 text-ink outline-none focus:shadow-[inset_0_0_0_1px_rgba(0,122,255,.45)]"
          value={note}
          placeholder="这一版是什么（可留空）"
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && busy === null) void save()
          }}
        />
        <button
          type="button"
          className="vp-btn h-26 cursor-pointer rounded-[7px] bg-accent px-9 whitespace-nowrap text-white enabled:hover:bg-[#0066d6] disabled:cursor-default disabled:opacity-50"
          disabled={busy !== null}
          onClick={() => void save()}
        >
          {busy === 'save' ? '保存中…' : '保存当前'}
        </button>
      </div>

      {flash && (
        <div className="vp-flash mx-10 mb-8 rounded-[7px] bg-[rgba(0,122,255,.08)] px-8 py-5 text-[11.5px] leading-[1.5] text-[#0058bd]">
          {flash}
        </div>
      )}
      {error && (
        <div className="vp-error mx-10 mb-8 rounded-[7px] bg-[#fdf6e7] px-8 py-5 text-[11.5px] leading-[1.5] text-[#8a5a12]">
          {error}
        </div>
      )}

      <div className="vp-list flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-10 pb-10">
        {versions === null && <div className="vp-empty px-2 py-12 text-ink-3">读取中…</div>}
        {versions?.length === 0 && (
          <div className="vp-empty px-2 py-12 text-ink-3">还没有版本。先「保存当前」留个底。</div>
        )}
        {versions?.map((version) => {
          const boardIds = Object.keys(version.boards)
          return (
            <div
              className="vp-item flex flex-col gap-5 rounded-[9px] bg-surface p-8 shadow-[0_0_0_1px_var(--color-line)]"
              key={version.id}
            >
              <div className="vp-meta flex items-center gap-8">
                <span className="vp-id font-mono text-[11px] text-ink">{version.id}</span>
                <span className="vp-time mr-auto text-[11px] tabular-nums text-ink-3">{formatTime(version.at)}</span>
                <button
                  type="button"
                  className={ITEM_BUTTON}
                  disabled={busy !== null}
                  onClick={() => void restore(version.id)}
                  title="整版恢复（恢复前自动备份当前状态）"
                >
                  {busy === `${version.id}:all` ? '恢复中…' : '恢复'}
                </button>
              </div>
              <div className="vp-note-text leading-[1.5] break-words text-ink-2">
                {version.note}
                {version.auto && (
                  <span className="vp-tag ml-6 rounded-[4px] bg-black/6 px-5 text-[10.5px] text-ink-3">自动</span>
                )}
              </div>
              <div className="vp-boards flex flex-wrap gap-4">
                {boardIds.map((boardId) => (
                  <button
                    type="button"
                    key={boardId}
                    className="vp-board flex max-w-full cursor-pointer items-baseline gap-5 rounded-[6px] bg-black/4 px-7 py-2 text-[11.5px] text-ink-2 enabled:hover:bg-black/9 enabled:hover:text-ink disabled:cursor-default disabled:opacity-45"
                    disabled={busy !== null}
                    onClick={() => void restore(version.id, boardId)}
                    title="只恢复这一块画板，其他画板不动"
                  >
                    <span className="vp-board-id font-mono text-[10.5px] text-ink-3">{boardId}</span>
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
