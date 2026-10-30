import { useEffect, useState } from 'react'
import { ApiError, fetchCanvases, type CanvasSummary } from '../api/client'

/** 登录后看到自己有哪些画布；每块一个随机 id 链接 */
export function CanvasList() {
  const [canvases, setCanvases] = useState<CanvasSummary[] | null>(null)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)

  useEffect(() => {
    let alive = true
    fetchCanvases()
      .then((data) => {
        if (alive) setCanvases(data.canvases)
      })
      .catch((err: ApiError) => {
        if (alive) setError({ code: err.code, message: err.message })
      })
    return () => {
      alive = false
    }
  }, [])

  const needLogin = error?.code === 'unauthorized'

  return (
    <div className="fixed inset-0 overflow-auto px-24 pt-72 pb-96">
      <div className="mx-auto w-[min(640px,100%)]">
        <h1 className="mb-6 text-[20px] font-semibold">我的画布</h1>
        <p className="mb-28 text-ink-2">每块画布有一个随机链接：拿到链接的人只能看，不能改。</p>

        {needLogin && (
          <a className="inline-block rounded-[8px] bg-accent px-16 py-8 text-[13px] text-white no-underline" href="/auth/google?redirect=/">
            用 Google 登录
          </a>
        )}

        {error && !needLogin && <p className="text-[#b45309]">{error.message}</p>}
        {!error && canvases === null && <p className="text-ink-2">正在读取…</p>}
        {canvases?.length === 0 && (
          <p className="text-ink-2">
            还没有画布。在本地写好 <code className="rounded-[4px] bg-black/6 px-5 py-1 font-mono">.artifact/</code>，然后
            <code className="ml-6 rounded-[4px] bg-black/6 px-5 py-1 font-mono">artifact push</code>
          </p>
        )}

        <ul className="flex flex-col gap-8 p-0">
          {canvases?.map((canvas) => (
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
      </div>
    </div>
  )
}
