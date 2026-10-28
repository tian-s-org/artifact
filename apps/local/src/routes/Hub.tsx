import { useEffect, useState } from 'react'
import { fetchProjects, type ProjectSummary } from '../api/client'

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
    <div className="hub">
      <header className="hub-head">
        <h1>项目</h1>
        <p>画布上的每一块画板都是一个 HTML 文件，由 Agent 直接编辑。</p>
      </header>

      {error && <p className="hub-error">{error}</p>}
      {!error && projects === null && <p className="hub-note">正在读取…</p>}
      {projects?.length === 0 && (
        <p className="hub-note">
          还没有项目。让 Agent 建一个：
          <code>pnpm new-board …</code>
        </p>
      )}

      <ul className="hub-list">
        {projects?.map((project) => (
          <li key={project.id}>
            <a href={`/p/${project.id}`}>
              <span className="hub-name">{project.name}</span>
              <span className="hub-meta">
                <span className="hub-id">{project.id}</span>
                <span>{project.boardCount} 块画板</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
