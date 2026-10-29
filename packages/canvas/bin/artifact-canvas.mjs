#!/usr/bin/env node
/**
 * 装成包之后的启动入口：
 *
 *   npx @tian-s-org/canvas --projects ./designs [--port 4330]
 *
 * 先注册本包自带的 tsx（不受用户当前目录影响），把参数落成环境变量，再起服务端。
 * 服务端只绑 127.0.0.1。
 */
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const USAGE = `artifact-canvas —— 起本地画布

用法：
  npx @tian-s-org/canvas [--projects <项目根>] [--port 4330]

  --projects <目录>   画布读哪个目录下的 <项目>/canvas.json（默认当前目录的 .artifact/）
  --port <端口>       监听端口（默认 4330）

打开 http://127.0.0.1:<端口>：/ 是项目列表，/p/<项目 id> 进画布。`

const argv = process.argv.slice(2)
let projects

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]
  if (arg === '-h' || arg === '--help') {
    console.log(USAGE)
    process.exit(0)
  } else if (arg === '--projects') {
    projects = argv[++i]
  } else if (arg.startsWith('--projects=')) {
    projects = arg.slice('--projects='.length)
  } else if (arg === '--port') {
    process.env.ARTIFACT_PORT = argv[++i] ?? ''
  } else if (arg.startsWith('--port=')) {
    process.env.ARTIFACT_PORT = arg.slice('--port='.length)
  } else {
    console.error(`未知参数：${arg}\n`)
    console.log(USAGE)
    process.exit(1)
  }
}

if (projects) process.env.ARTIFACT_PROJECTS = path.resolve(projects)

const require = createRequire(import.meta.url)
const { register } = await import(pathToFileURL(require.resolve('tsx/esm/api')).href)
register()

await import(new URL('../server/index.ts', import.meta.url).href)
