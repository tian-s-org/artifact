/**
 * E2E 底座：临时项目目录 + 生产服务 + Playwright 浏览器。
 *
 * 每个测试文件各自起一个服务、用一个临时 ARTIFACT_PROJECTS，
 * 所以测试里怎么写文件都不会碰到仓库里的 projects/ 示例。
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, webkit, type Browser } from 'playwright'

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DIST = path.join(APP_ROOT, 'dist')

export interface FixtureBoard {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  /** 画板 HTML；不写就是一句占位文字 */
  html?: string
}

export interface FixtureProject {
  id: string
  name: string
  boards: FixtureBoard[]
}

/** 画板统一样式：同一套 class、可换的颜色，用来验隔离 */
export function boardHtml(title: string, accent: string, extra = ''): string {
  return `<!doctype html>
<html lang="zh-Hans"><head><meta charset="utf-8"><title>${title}</title>
<style>
  :root { --accent: ${accent}; }
  body { margin: 0; height: 100vh; display: grid; place-items: center;
         font: 13px/1.6 -apple-system, "PingFang SC", sans-serif; color: #111; }
  .accent { color: var(--accent); font-size: 24px; }
  .line { width: 120px; height: 1px; background: var(--accent); }
</style></head>
<body>
  <div>
    <div class="accent">${title}</div>
    <div class="line"></div>
  </div>
  ${extra}
</body></html>
`
}

export function writeProject(root: string, project: FixtureProject): void {
  const dir = path.join(root, project.id)
  fs.mkdirSync(path.join(dir, 'design-system'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'canvas.json'),
    `${JSON.stringify(
      {
        protocol: 1,
        id: project.id,
        name: project.name,
        context: 'context.md',
        designSystem: { tokens: 'design-system/tokens.json', guidelines: 'design-system/guidelines.md' },
        boards: project.boards.map((board, index) => ({
          id: board.id,
          name: board.name,
          x: board.x,
          y: board.y,
          width: board.width,
          height: board.height,
          file: `artboards/${board.id}/index.html`,
          order: index + 1,
        })),
      },
      null,
      2,
    )}\n`,
  )
  fs.writeFileSync(path.join(dir, 'context.md'), `# ${project.name}\n`)
  fs.writeFileSync(path.join(dir, 'design-system', 'tokens.json'), '{}\n')
  fs.writeFileSync(path.join(dir, 'design-system', 'guidelines.md'), '# 规则\n')
  for (const board of project.boards) {
    const boardDir = path.join(dir, 'artboards', board.id)
    fs.mkdirSync(boardDir, { recursive: true })
    fs.writeFileSync(path.join(boardDir, 'index.html'), board.html ?? boardHtml(`${board.name}`, '#334155'))
  }
}

export interface RunningServer {
  baseUrl: string
  projectsRoot: string
  stop: () => Promise<void>
}

/** dist 里比源码旧就重打一次：E2E 跑的是生产产物，不是 Vite 开发服务 */
function ensureBuilt(): void {
  const stamp = path.join(DIST, 'index.html')
  const newest = (dir: string, current = 0): number => {
    if (!fs.existsSync(dir)) return current
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) current = newest(abs, current)
      else if (/\.(tsx?|css|html)$/.test(entry.name)) current = Math.max(current, fs.statSync(abs).mtimeMs)
    }
    return current
  }
  const sources = [
    path.join(APP_ROOT, 'index.html'),
    path.join(APP_ROOT, 'src'),
    path.join(APP_ROOT, 'shared'),
    path.join(APP_ROOT, '../../packages/canvas-core/src'),
  ]
  const latest = sources.reduce((max, source) => {
    if (!fs.existsSync(source)) return max
    const stat = fs.statSync(source)
    return stat.isDirectory() ? newest(source, max) : Math.max(max, stat.mtimeMs)
  }, 0)

  if (fs.existsSync(stamp) && fs.statSync(stamp).mtimeMs >= latest) return
  const result = spawnSync('pnpm', ['exec', 'vite', 'build'], { cwd: APP_ROOT, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`vite build 失败：\n${result.stdout}\n${result.stderr}`)
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => (port > 0 ? resolve(port) : reject(new Error('拿不到空闲端口'))))
    })
  })
}

export async function startServer(projects: FixtureProject[]): Promise<RunningServer> {
  ensureBuilt()
  const projectsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-e2e-'))
  for (const project of projects) writeProject(projectsRoot, project)

  const port = await freePort()
  const child: ChildProcess = spawn('node', ['--import', 'tsx', 'server/index.ts'], {
    cwd: APP_ROOT,
    env: { ...process.env, ARTIFACT_PORT: String(port), ARTIFACT_PROJECTS: projectsRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logs: string[] = []
  child.stdout?.on('data', (chunk) => logs.push(String(chunk)))
  child.stderr?.on('data', (chunk) => logs.push(String(chunk)))

  const baseUrl = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 20_000
  for (;;) {
    if (child.exitCode !== null) throw new Error(`服务提前退出：\n${logs.join('')}`)
    try {
      const res = await fetch(`${baseUrl}/api`)
      if (res.ok) break
    } catch {
      /* 还没起来 */
    }
    if (Date.now() > deadline) throw new Error(`服务 20 秒没起来：\n${logs.join('')}`)
    await new Promise((resolve) => setTimeout(resolve, 120))
  }

  return {
    baseUrl,
    projectsRoot,
    stop: async () => {
      child.kill('SIGTERM')
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve()
        child.once('exit', () => resolve())
        setTimeout(resolve, 3000)
      })
      fs.rmSync(projectsRoot, { recursive: true, force: true })
    },
  }
}

const BROWSERS = { chromium, webkit } as const

export async function launch(kind: keyof typeof BROWSERS): Promise<Browser> {
  return BROWSERS[kind].launch()
}

/** 画布当前变换：左上的屏幕位移与缩放。world 的 left/top 是「位移 ÷ 缩放」，换算回来。 */
export interface ViewState {
  x: number
  y: number
  scale: number
}

export async function readView(page: import('playwright').Page): Promise<ViewState> {
  return page.evaluate(() => {
    const world = document.querySelector('.canvas-world') as HTMLElement | null
    if (!world) return { x: 0, y: 0, scale: 1 }
    const scale = Number(world.style.zoom) || 1
    return {
      x: (parseFloat(world.style.left) || 0) * scale,
      y: (parseFloat(world.style.top) || 0) * scale,
      scale,
    }
  })
}

/** 画板在屏幕上的矩形 */
export async function boardRects(
  page: import('playwright').Page,
): Promise<Array<{ id: string; left: number; top: number; width: number; height: number }>> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.board')].map((el) => {
      const box = el.getBoundingClientRect()
      const id = (el.querySelector('.board-id')?.textContent ?? '').trim()
      return { id, left: box.left, top: box.top, width: box.width, height: box.height }
    }),
  )
}

export async function waitForBoards(page: import('playwright').Page, count: number): Promise<void> {
  await page.waitForFunction((n) => document.querySelectorAll('.board').length >= n, count, { timeout: 15_000 })
  // 首屏取景在画板挂上之后的下一帧才生效，稳一下再断言
  await page.waitForTimeout(150)
}
