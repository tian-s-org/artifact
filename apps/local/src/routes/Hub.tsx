import { useEffect, useState } from 'react'
import { fetchProjects, type ProjectSummary } from '../api/client'

/** 列表、说明、报错同一条栏宽，居中 */
const COLUMN = 'mx-auto w-[min(640px,100%)]'

/** 项目列表：画布之外唯一的一屏，只读。项目本身由 Agent 用 pnpm new-board 创建。 */
export function Hub() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetchProjects()
      .then((data) => {
        if (alive) setProjects(data.projects)
      })
      .catch((err: Error) => {
        if (alive) setError(err.message)
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="hub fixed inset-0 overflow-auto px-24 pt-72 pb-96">
      <header className={`hub-head ${COLUMN}`}>
        <h1 className="mb-6 text-[20px] font-semibold">项目</h1>
        <p className="mb-28 text-ink-2">画布上的每一块画板都是一个 HTML 文件，由 Agent 直接编辑。</p>
      </header>

      {error && <p className={`hub-error ${COLUMN} text-[#b45309]`}>{error}</p>}
      {!error && projects === null && <p className={`hub-note ${COLUMN} text-ink-2`}>正在读取…</p>}
      {projects?.length === 0 && (
        <p className={`hub-note ${COLUMN} text-ink-2`}>
          还没有项目。让 Agent 建一个：
          <code className="ml-6 rounded-[4px] bg-black/6 px-5 py-1 font-mono text-[12px]">pnpm new-board …</code>
        </p>
      )}

      <ul className={`hub-list ${COLUMN} flex flex-col gap-8 p-0`}>
        {projects?.map((project) => (
          <li key={project.id}>
            <a
              href={`/p/${project.id}`}
              className="flex items-baseline justify-between gap-16 rounded-[10px] bg-surface px-16 py-14 text-inherit no-underline shadow-[0_0_0_1px_var(--color-line)] hover:shadow-[0_0_0_1px_rgba(0,0,0,.14),0_6px_18px_rgba(0,0,0,.06)]"
            >
              <span className="hub-name font-semibold">{project.name}</span>
              <span className="hub-meta flex gap-10 text-[12px] text-ink-3">
                <span className="hub-id font-mono">{project.id}</span>
                <span>{project.boardCount} 块画板</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
