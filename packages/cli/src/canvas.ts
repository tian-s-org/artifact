/**
 * artifact-cli canvas：起本地画布。
 *
 * 默认启动装在本包依赖里的底座 `@tian-s-org/canvas`（跑它的 bin），
 * 所以只要装了 CLI，在任意项目里都能起画布，不需要 artifact 仓库在场。
 *
 * `--repo <artifact 仓库>` 是开发态回退：直接跑仓库里那份源码。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

/** 仓库里底座所在目录（--repo 回退用） */
const REPO_APP = path.join('apps', 'local')
const REPO_BIN = path.join(REPO_APP, 'bin', 'artifact-canvas.mjs')

export interface CanvasOptions {
  repo?: string
  projects?: string
  port?: number
}

export interface ResolvedCanvas {
  /** 底座的启动脚本 */
  bin: string
  /** 项目根；undefined 交给底座自己按当前目录推 */
  projects?: string
  /** 给人看的来源说明 */
  label: string
}

/** 从 start 往上找带 apps/local/bin/artifact-canvas.mjs 的目录 */
export function findRepoRoot(start: string = process.cwd()): string | null {
  let dir = path.resolve(start)
  for (;;) {
    if (fs.existsSync(path.join(dir, REPO_BIN))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** 装在本包依赖里的底座 bin */
export function findCanvasBin(): string {
  const require = createRequire(import.meta.url)
  const pkgJson = require.resolve('@tian-s-org/canvas/package.json')
  return path.join(path.dirname(pkgJson), 'bin', 'artifact-canvas.mjs')
}

export function resolveCanvas(options: CanvasOptions): ResolvedCanvas {
  if (options.repo) {
    const repo = path.resolve(options.repo)
    if (!fs.existsSync(path.join(repo, REPO_BIN))) {
      throw new Error(`${repo} 里没有 ${REPO_BIN}，不像 artifact 仓库`)
    }
    return {
      bin: path.join(repo, REPO_BIN),
      projects: options.projects ? path.resolve(options.projects) : path.join(repo, 'projects'),
      label: `仓库  ${repo}`,
    }
  }
  return {
    bin: findCanvasBin(),
    projects: options.projects ? path.resolve(options.projects) : undefined,
    label: '底座  已安装的 @tian-s-org/canvas',
  }
}

/** 起画布并接管信号；返回一个在画布退出时结束的 Promise */
export function runCanvas(resolved: ResolvedCanvas, port?: number): Promise<number> {
  const args = [resolved.bin]
  if (resolved.projects) args.push('--projects', resolved.projects)
  if (port !== undefined) args.push('--port', String(port))

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' })
    const forward = (signal: NodeJS.Signals) => () => child.kill(signal)
    process.once('SIGINT', forward('SIGINT'))
    process.once('SIGTERM', forward('SIGTERM'))
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      resolve(code ?? (signal ? 1 : 0))
    })
  })
}
