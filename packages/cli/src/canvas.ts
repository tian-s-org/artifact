/**
 * artifact canvas：在找到的 artifact 仓库里起本地画布。
 *
 * CLI 自己不实现画布，只负责找仓库、拼参数、转信号——
 * 画布与技能安装是两件事，将来云端版也走同一条命令（换 --server）。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const SERVER_ENTRY = path.join('apps', 'local', 'server', 'index.ts')

/** 从 start 往上找带 apps/local/server/index.ts 的目录 */
export function findRepoRoot(start: string = process.cwd()): string | null {
  let dir = path.resolve(start)
  for (;;) {
    if (fs.existsSync(path.join(dir, SERVER_ENTRY))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export interface CanvasOptions {
  repo?: string
  projects?: string
  port?: number
}

export function resolveCanvas(options: CanvasOptions): { repo: string; appDir: string; projects: string } {
  const repo = options.repo ? path.resolve(options.repo) : findRepoRoot()
  if (!repo) {
    throw new Error('找不到 artifact 仓库：在仓库目录里执行，或加 --repo <路径>')
  }
  if (!fs.existsSync(path.join(repo, SERVER_ENTRY))) {
    throw new Error(`${repo} 里没有 ${SERVER_ENTRY}，不像 artifact 仓库`)
  }
  return {
    repo,
    appDir: path.join(repo, 'apps', 'local'),
    projects: options.projects ? path.resolve(options.projects) : path.join(repo, 'projects'),
  }
}

/** 起服务并接管信号；返回一个在服务退出时结束的 Promise */
export function runCanvas(options: CanvasOptions): Promise<number> {
  const { appDir, projects } = resolveCanvas(options)
  const env: NodeJS.ProcessEnv = { ...process.env, ARTIFACT_PROJECTS: projects }
  if (options.port !== undefined) env.ARTIFACT_PORT = String(options.port)

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd: appDir,
      env,
      stdio: 'inherit',
    })
    const forward = (signal: NodeJS.Signals) => () => child.kill(signal)
    process.once('SIGINT', forward('SIGINT'))
    process.once('SIGTERM', forward('SIGTERM'))
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      resolve(code ?? (signal ? 1 : 0))
    })
  })
}
