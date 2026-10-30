/**
 * 把本地项目推到云端画布。
 *
 *   node --import tsx scripts/push.ts brand architecture web-ui
 *   node --import tsx scripts/push.ts --all --url https://artifact.tianyw0.xyz
 *
 * 只推 layout.json、context.md、artboards/、assets/、design-system/；
 * versions/ 不上传（云端自己存版本），点文件跳过。
 * 密钥取 ARTIFACT_KEY 环境变量，或 apps/cloud/.dev.vars 里的 SITE_KEY。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLOUD_ROOT = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(CLOUD_ROOT, '../..')
const DEFAULT_PROJECTS = path.join(REPO_ROOT, 'projects')
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.woff', '.woff2', '.ttf', '.otf'])

interface Args {
  projects: string[]
  all: boolean
  url: string
  key: string
  root: string
}

async function readDevVars(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  try {
    const text = await fs.readFile(path.join(CLOUD_ROOT, '.dev.vars'), 'utf8')
    for (const line of text.split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (match?.[1]) out[match[1]] = (match[2] ?? '').replace(/^["']|["']$/g, '')
    }
  } catch {
    /* 没有就算了 */
  }
  return out
}

async function parseArgs(argv: string[]): Promise<Args> {
  const devVars = await readDevVars()
  const args: Args = {
    projects: [],
    all: false,
    url: process.env.ARTIFACT_URL ?? 'https://artifact.tianyw0.xyz',
    key: process.env.ARTIFACT_KEY ?? devVars.SITE_KEY ?? '',
    root: process.env.ARTIFACT_PROJECTS ?? DEFAULT_PROJECTS,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--all') args.all = true
    else if (arg === '--url') args.url = argv[++i] ?? args.url
    else if (arg === '--key') args.key = argv[++i] ?? args.key
    else if (arg === '--projects') args.root = path.resolve(argv[++i] ?? args.root)
    else if (arg && !arg.startsWith('-')) args.projects.push(arg)
  }
  return args
}

interface FileInput {
  path: string
  content: string
  encoding?: 'base64'
}

async function collectFiles(projectDir: string): Promise<FileInput[]> {
  const files: FileInput[] = []

  const add = async (rel: string): Promise<void> => {
    const abs = path.join(projectDir, rel)
    const ext = path.extname(rel).toLowerCase()
    if (BINARY_EXT.has(ext)) {
      files.push({ path: rel, content: (await fs.readFile(abs)).toString('base64'), encoding: 'base64' })
    } else {
      files.push({ path: rel, content: await fs.readFile(abs, 'utf8') })
    }
  }

  const walk = async (rel: string): Promise<void> => {
    const entries = await fs.readdir(path.join(projectDir, rel), { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const child = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) await walk(child)
      else if (entry.isFile()) await add(child)
    }
  }

  await walk('artboards').catch(() => undefined)
  await walk('assets').catch(() => undefined)
  await walk('design-system').catch(() => undefined)
  for (const fixed of ['layout.json', 'context.md']) {
    await add(fixed).catch(() => undefined)
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

async function pushProject(projectId: string, args: Args): Promise<void> {
  const dir = path.join(args.root, projectId)
  const canvas = JSON.parse(await fs.readFile(path.join(dir, 'layout.json'), 'utf8')) as { name?: string }
  const files = await collectFiles(dir)
  if (files.length === 0) throw new Error(`${projectId}：没有可推的文件`)

  const res = await fetch(`${args.url}/api/projects/${projectId}/files`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${args.key}` },
    body: JSON.stringify({ files, createProject: true, name: canvas.name ?? projectId }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${projectId}：${res.status} ${text.slice(0, 300)}`)
  const data = JSON.parse(text) as { files: { path: string; size: number }[] }
  const bytes = data.files.reduce((sum, f) => sum + f.size, 0)
  console.log(`✓ ${projectId}  ${data.files.length} 个文件  ${(bytes / 1024).toFixed(1)} KB`)
}

async function main(): Promise<void> {
  const args = await parseArgs(process.argv.slice(2))
  if (args.key === '') throw new Error('缺少密钥：设 ARTIFACT_KEY，或在 apps/cloud/.dev.vars 里写 SITE_KEY')

  let ids = args.projects
  if (args.all || ids.length === 0) {
    const entries = await fs.readdir(args.root, { withFileTypes: true })
    ids = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name)
  }
  for (const id of ids) await pushProject(id, args)
  console.log(`→ ${args.url}`)
}

await main()
