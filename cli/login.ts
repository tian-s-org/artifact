/**
 * artifact login：起一个本机回环回调，打开浏览器让用户在 Web 上（Google 登录后）授权，
 * 拿一次性 code 换长期 token，存到 ~/.config/artifact/credentials.json。
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { saveCredentials } from './credentials'

const TIMEOUT_MS = 5 * 60 * 1000

function openUrl(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref()
}

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>已授权</title>
<body style="font:14px -apple-system,sans-serif;display:grid;place-items:center;height:100vh;margin:0">
<p>授权完成，可以关闭这个窗口，回到终端。</p></body>`

export interface LoginOptions {
  url: string
}

export async function login(options: LoginOptions): Promise<string> {
  const base = options.url.replace(/\/$/, '')
  const state = randomBytes(16).toString('hex')

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('state 不匹配')
        return
      }
      const value = url.searchParams.get('code')
      if (!value) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('没有拿到授权码')
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(DONE_PAGE)
      cleanup()
      resolve(value)
    })

    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('等授权超时（5 分钟），请重试'))
    }, TIMEOUT_MS)

    const cleanup = (): void => {
      clearTimeout(timer)
      server.close()
    }

    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      if (!port) {
        cleanup()
        reject(new Error('起不了本机回调端口'))
        return
      }
      const redirect = `http://127.0.0.1:${port}/callback`
      const target = `${base}/cli/authorize?redirect=${encodeURIComponent(redirect)}&state=${state}`
      console.log(`在浏览器里确认授权：${target}`)
      openUrl(target)
    })
    server.once('error', (err) => {
      cleanup()
      reject(err)
    })
  })

  const res = await fetch(`${base}/api/cli/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  if (!res.ok) throw new Error(`换 token 失败（${res.status}）：${await res.text()}`)
  const data = (await res.json()) as { token?: string }
  if (!data.token) throw new Error('服务端没有返回 token')

  const file = await saveCredentials({ url: base, token: data.token, savedAt: new Date().toISOString() })
  console.log(`已登录，token 存在 ${file}`)
  return data.token
}
