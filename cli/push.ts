/**
 * artifact push：把本地 .artifact/ 整包推到云端。
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

export interface PushOptions {
  /** 本地画布目录；默认当前目录的 .artifact */
  dir?: string
  url: string
  /** CLI token；本地开发模式可以不传 */
  key?: string
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

export async function push(options: PushOptions): Promise<number> {
  const root = path.resolve(options.dir ?? path.join(process.cwd(), '.artifact'))
  try {
    await fs.access(path.join(root, 'layout.json'))
  } catch {
    throw new Error(`${root} 里没有 layout.json，不像一个画布目录`)
  }

  const files = await collect(root)
  if (files.length > MAX_FILES) throw new Error(`文件太多：${files.length} 个（一次最多 ${MAX_FILES}）`)

  let res: Response
  try {
    res = await fetch(`${options.url.replace(/\/$/, '')}/api/files`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(options.key ? { authorization: `Bearer ${options.key}` } : {}),
      },
      body: JSON.stringify({ files }),
    })
  } catch (err) {
    throw new Error(`连不上 ${options.url}：${(err as Error).message}`)
  }

  const text = await res.text()
  if (!res.ok) {
    let message = text
    try {
      message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text
    } catch {
      // 保持原文
    }
    throw new Error(`推送失败（${res.status}）：${message}`)
  }

  console.log(`已推送 ${files.length} 个文件 → ${options.url}`)
  return files.length
}
