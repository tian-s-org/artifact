/**
 * 本地服务入口。
 *
 * 生产（pnpm start）：一个进程同时发 SPA、/api、/events、/files。
 * 开发（pnpm dev）：本进程只管 /api /events /files（默认 4331），SPA 由 Vite 在 4330 提供并反代这三条路径。
 *
 * 只绑 127.0.0.1——画布是本地工具，不上网。
 */
import fs from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventBus } from './events'
import { handleApi } from './http/api'
import { handleProjectFile, serveStatic } from './http/files'
import { handleEvents } from './http/sse'
import { projectsRoot, REPO_ROOT } from './paths'
import { FsStorageProvider } from './storage/fs-storage'
import { FsProjectRepository } from './storage/project-repo'
import { FsVersionStore } from './storage/versions'
import { ProjectWatcher } from './watch'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIST_DIR = path.resolve(HERE, '../dist')
const HOST = '127.0.0.1'
const PORT = Number(process.env.ARTIFACT_PORT ?? 4330)

const root = projectsRoot()
fs.mkdirSync(root, { recursive: true })

const storage = new FsStorageProvider(root)
const repo = new FsProjectRepository(root)
const versions = new FsVersionStore(root)
const bus = new EventBus()
const watcher = new ProjectWatcher({ root, bus })
watcher.start()

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}`)
  const pathname = url.pathname

  if (pathname.startsWith('/files/')) {
    handleProjectFile(req, res, root, url)
    return
  }
  if (pathname === '/events') {
    handleEvents(req, res, bus, url)
    return
  }
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    void handleApi(req, res, url, { repo, storage, versions, bus })
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end()
    return
  }

  // 生产模式：发 dist；开发模式下 dist 可能不存在，给一句人话
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1)
  if (serveStatic(res, DIST_DIR, rel)) return
  if (serveStatic(res, DIST_DIR, 'index.html')) return // SPA 深链回退

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(
    fs.existsSync(DIST_DIR)
      ? 'not found'
      : '还没有构建产物。开发用 pnpm dev（Vite 在 4330），预览生产用 pnpm build && pnpm start。',
  )
})

server.listen(PORT, HOST, () => {
  console.log(`\n  artifact  ·  http://${HOST}:${PORT}`)
  console.log(`  项目目录  ${root.replace(REPO_ROOT, '.')}`)
  console.log(`  监听中    projects/ 下的文件变化\n`)
})

const shutdown = (): void => {
  watcher.close()
  server.close(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
