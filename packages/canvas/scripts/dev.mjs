#!/usr/bin/env node
/**
 * 开发模式：Vite（前端热更新，4330）+ tsx watch（API、SSE、画板资源，4331）。
 * 生产是一个进程（pnpm start），所以前端一律写相对路径。
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(here, '..')

const WEB_PORT = process.env.ARTIFACT_PORT ?? '4330'
const API_PORT = process.env.ARTIFACT_API_PORT ?? '4331'

const children = []
let exiting = false

function run(name, cmd, args, env) {
  const child = spawn(cmd, args, {
    cwd: appDir,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)
  const prefix = name === 'web' ? '\x1b[36mweb\x1b[0m' : '\x1b[35mapi\x1b[0m'
  const relay = (stream, target) => {
    let buffer = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) target.write(`${prefix} ${line}\n`)
    })
  }
  relay(child.stdout, process.stdout)
  relay(child.stderr, process.stderr)
  child.on('exit', (code, signal) => {
    if (exiting) return
    console.error(`${prefix} 进程退出 code=${code} signal=${signal}，一并关闭另一个`)
    shutdown(code ?? 1)
  })
  return child
}

function shutdown(code) {
  if (exiting) return
  exiting = true
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM')
  }
  setTimeout(() => process.exit(code), 200)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

run('api', 'node', ['--import', 'tsx', '--watch', 'server/index.ts'], { ARTIFACT_PORT: API_PORT })
run('web', 'node', ['./node_modules/vite/bin/vite.js'], {
  ARTIFACT_PORT: WEB_PORT,
  ARTIFACT_API: `http://127.0.0.1:${API_PORT}`,
})

console.log(`\n  开发模式：前端 http://127.0.0.1:${WEB_PORT}   API http://127.0.0.1:${API_PORT}\n`)
