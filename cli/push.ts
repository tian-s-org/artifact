/**
 * artifact push：把本地 .artifact/ 整包推到云端。
 *
 * 一块画布一个随机 id：目录里没有 `.canvas` 就先建一块新画布，
 * 把 id 写进 `<目录>/.canvas`，之后每次 push 都推到这一块。
 *
 * 推的是源文件（HTML/CSS/SVG/图片/字体/layout.json），不编译、不内联；
 * 只收 layout.json、context.md、artboards/、assets/，点文件一律跳过。
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.woff', '.woff2', '.ttf', '.otf'])
const FIXED = new Set(['layout.json', 'context.md'])
const PREFIXES = ['artboards/', 'assets/']
const MAX_FILES = 200
const ID_FILE = '.canvas'

export interface PushOptions {
  /** 本地画布目录；默认当前目录的 .artifact */
  dir?: string
  url: string
  /** CLI token；本地开发模式可以不传 */
  key?: string
  /** 指定画布 id；不传就读目录里的 .canvas，没有就新建 */
  canvasId?: string
}

export interface PushResult {
  canvasId: string
  files: number
  url: string
}

interface PushFile {
  path: string
  content: string
  encoding?: 'base64'
}

function included(rel: string): boolean {
  if (FIXED.has(rel)) return true
  return PREFIXES.some((prefix) => rel.startsWith(prefix))
}

function isBinary(rel: string): boolean {
  return BINARY_EXT.has(path.posix.extname(rel).toLowerCase())
}

async function collect(root: string): Promise<PushFile[]> {
  const out: PushFile[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(abs)
        continue
      }
      if (!entry.isFile()) continue
      const rel = path.relative(root, abs).split(path.sep).join('/')
      if (!included(rel)) continue
      const data = await fs.readFile(abs)
      out.push(
        isBinary(rel)
          ? { path: rel, content: data.toString('base64'), encoding: 'base64' }
          : { path: rel, content: data.toString('utf8') },
      )
    }
  }
  await walk(root)
  return out
}

function authHeaders(key?: string): Record<string, string> {
  return key ? { authorization: `Bearer ${key}` } : {}
}

async function readError(res: Response): Promise<string> {
  const text = await res.text()
  try {
    return (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text
  } catch {
    return text
  }
}

async function canvasIdFromFile(root: string): Promise<string | null> {
  const raw = await fs.readFile(path.join(root, ID_FILE), 'utf8').catch(() => null)
  const id = raw?.trim() ?? ''
  return /^[a-f0-9]{24}$/.test(id) ? id : null
}

async function createCanvas(url: string, key: string | undefined, name: string): Promise<string> {
  const res = await fetch(`${url}/api/canvases`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(key) },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error(`新建画布失败（${res.status}）：${await readError(res)}`)
  const data = (await res.json()) as { canvas?: { id?: string } }
  if (!data.canvas?.id) throw new Error('服务端没有返回画布 id')
  return data.canvas.id
}

export async function push(options: PushOptions): Promise<PushResult> {
  const base = options.url.replace(/\/$/, '')
  const root = path.resolve(options.dir ?? path.join(process.cwd(), '.artifact'))
  const layoutPath = path.join(root, 'layout.json')
  let layoutText: string
  try {
    layoutText = await fs.readFile(layoutPath, 'utf8')
  } catch {
    throw new Error(`${root} 里没有 layout.json，不像一个画布目录`)
  }

  let canvasId = options.canvasId ?? (await canvasIdFromFile(root))
  if (!canvasId) {
    let name = ''
    try {
      name = (JSON.parse(layoutText) as { name?: string }).name ?? ''
    } catch {
      throw new Error('layout.json 不是合法 JSON')
    }
    canvasId = await createCanvas(base, options.key, name)
    await fs.writeFile(path.join(root, ID_FILE), `${canvasId}\n`)
    console.log(`新建画布 ${canvasId}`)
  }

  const files = await collect(root)
  if (files.length > MAX_FILES) throw new Error(`文件太多：${files.length} 个（一次最多 ${MAX_FILES}）`)

  let res: Response
  try {
    res = await fetch(`${base}/api/c/${canvasId}/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(options.key) },
      body: JSON.stringify({ files }),
    })
  } catch (err) {
    throw new Error(`连不上 ${base}：${(err as Error).message}`)
  }
  if (!res.ok) throw new Error(`推送失败（${res.status}）：${await readError(res)}`)

  const url = `${base}/c/${canvasId}`
  console.log(`已推送 ${files.length} 个文件 → ${url}`)
  return { canvasId, files: files.length, url }
}
