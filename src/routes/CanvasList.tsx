import { useCallback, useEffect, useState } from 'react'
import { ApiError, fetchCanvases, fetchMe, logout, type CanvasSummary, type Me } from '../api/client'
import { UserChip } from '../canvas/UserChip'

type View = 'cards' | 'list'

const VIEW_KEY = 'artifact:canvas-view'

function readView(): View {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards'
  } catch {
    return 'cards'
  }
}

/** 个人中心：登录态、画布列表（卡片 / 列表两种看法）、退出 */
export function CanvasList() {
  const [me, setMe] = useState<Me | null>(null)
  const [checked, setChecked] = useState(false)
  const [canvases, setCanvases] = useState<CanvasSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>(readView)

  useEffect(() => {
    let alive = true
    fetchMe()
      .then((data) => {
        if (alive) setMe(data)
      })
      .catch(() => {
        if (alive) setMe(null)
      })
      .finally(() => {
        if (alive) setChecked(true)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!me) return
    let alive = true
    fetchCanvases()
      .then((data) => {
        if (alive) setCanvases(data.canvases)
      })
      .catch((err: ApiError) => {
        if (alive) setError(err.message)
      })
    return () => {
      alive = false
    }
  }, [me])

  const switchView = useCallback((next: View) => {
    setView(next)
    try {
      window.localStorage.setItem(VIEW_KEY, next)
    } catch {
      // 存不了不影响本次
    }
  }, [])

  const signOut = useCallback(async () => {
    await logout().catch(() => undefined)
    window.location.reload()
  }, [])

  return (
    <div className="fixed inset-0 overflow-auto px-24 pt-72 pb-96">
      <div className="mx-auto w-[min(880px,100%)]">
        <header className="mb-24 flex items-baseline gap-12">
          <h1 className="m-0 text-[20px] font-semibold">个人中心</h1>
          <span className="text-[12px] text-ink-3">每块画布一个链接；打开要登录，链接只决定看哪一块</span>
          <div className="ml-auto flex items-center gap-10">
            {me ? (
              <>
                <UserChip me={me} plain />
                <button
                  type="button"
                  className="cursor-pointer rounded-[6px] bg-black/6 px-10 py-4 text-[12px] text-ink-2 hover:bg-black/10"
                  onClick={() => void signOut()}
                >
                  退出
                </button>
              </>
            ) : (
              <a className="rounded-[7px] bg-accent px-12 py-5 text-[12.5px] text-white no-underline" href="/auth/google?redirect=/">
                用 Google 登录
              </a>
            )}
          </div>
        </header>

        {me && (
          <div className="mb-16 flex items-center gap-8">
            <span className="text-[12.5px] text-ink-2">我的画布 {canvases?.length ?? ''}</span>
            <div className="ml-auto flex gap-2 rounded-[7px] bg-black/4 p-2">
              {(['cards', 'list'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={view === mode}
                  className={`cursor-pointer rounded-[5px] px-10 py-3 text-[12px] ${
                    view === mode ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--color-line)]' : 'text-ink-2'
                  }`}
                  onClick={() => switchView(mode)}
                >
                  {mode === 'cards' ? '卡片' : '列表'}
                </button>
              ))}
            </div>
          </div>
        )}

        {!checked && <p className="text-ink-2">正在读取…</p>}
        {checked && !me && <p className="text-ink-2">登录后可以看到自己的画布。</p>}
        {error && <p className="text-[#b45309]">{error}</p>}
        {me && canvases === null && !error && <p className="text-ink-2">正在读取…</p>}
        {canvases?.length === 0 && (
          <p className="text-ink-2">
            还没有画布。在本地写好 <code className="rounded-[4px] bg-black/6 px-5 py-1 font-mono">.artifact/</code>，然后
            <code className="ml-6 rounded-[4px] bg-black/6 px-5 py-1 font-mono">artifact push</code>
          </p>
        )}

        {canvases && canvases.length > 0 && view === 'cards' && (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-12 p-0">
            {canvases.map((canvas) => (
              <li key={canvas.id}>
                <a
                  href={`/c/${canvas.id}`}
                  className="block rounded-[12px] bg-surface p-16 text-inherit no-underline shadow-[0_0_0_1px_var(--color-line)] hover:shadow-[0_0_0_1px_rgba(0,0,0,.14),0_6px_18px_rgba(0,0,0,.06)]"
                >
                  <div className="mb-6 text-[14px] font-semibold">{canvas.name}</div>
                  <div className="font-mono text-[11px] text-ink-3">{canvas.id.slice(0, 12)}</div>
                  <div className="mt-12 text-[11.5px] text-ink-3">{canvas.at.slice(0, 10)}</div>
                </a>
              </li>
            ))}
          </ul>
        )}

        {canvases && canvases.length > 0 && view === 'list' && (
          <ul className="flex flex-col gap-8 p-0">
            {canvases.map((canvas) => (
              <li key={canvas.id}>
                <a
                  href={`/c/${canvas.id}`}
                  className="flex items-baseline justify-between gap-16 rounded-[10px] bg-surface px-16 py-14 text-inherit no-underline shadow-[0_0_0_1px_var(--color-line)] hover:shadow-[0_0_0_1px_rgba(0,0,0,.14),0_6px_18px_rgba(0,0,0,.06)]"
                >
                  <span className="font-semibold">{canvas.name}</span>
                  <span className="flex gap-10 text-[12px] text-ink-3">
                    <span className="font-mono">{canvas.id.slice(0, 8)}</span>
                    <span>{canvas.at.slice(0, 10)}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
