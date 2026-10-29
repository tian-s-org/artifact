/**
 * 路径规则集中在这里：项目根目录怎么找、什么能对外发、什么一律拒绝。
 * 画布组件里不允许出现绝对本地路径，所有路径到这里都还是 POSIX 相对键。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isId } from '@tian-s-org/schema'

/** 本包根目录：server/ 的上一级。装成包后就是 node_modules/@tian-s-org/canvas */
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 仓库根（artifact/）——只在 artifact 仓库里直接跑脚本时用得到 */
export const REPO_ROOT = path.resolve(PKG_ROOT, '../..')

/**
 * 默认项目目录：
 * 1) 环境变量优先——`artifact-cli canvas --projects`、`ARTIFACT_PROJECTS` 都靠它指路；
 * 2) 当前目录在 artifact 仓库里时，用仓库根的 projects/（本地开发数据，已 gitignore）；
 * 3) 装进别的项目、由使用者起画布时，用当前目录下的 .artifact/（隐藏目录，不跟项目自己的文件混）。
 */
export function projectsRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ARTIFACT_PROJECTS) return path.resolve(env.ARTIFACT_PROJECTS)
  const repoProjects = path.join(REPO_ROOT, 'projects')
  // 只有「当前就在仓库里」才算仓库内开发；从别的项目调用仓库里的 CLI 时，目录是别人的
  if (isInside(REPO_ROOT, process.cwd())) return repoProjects
  return path.resolve(process.cwd(), '.artifact')
}

/** child 是否就是 parent 或在它下面 */
function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** 对外可以发的顶层目录。canvas.json / context.md / versions / 任何其它文件一律不发。 */
const SERVABLE_PREFIXES = ['artboards/', 'assets/', 'design-system/'] as const

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.json': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
}

export function mimeFor(rel: string): string {
  return MIME[path.posix.extname(rel).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * 一个相对键是否允许通过 /files 对外发。
 * 只放行三个顶层目录、只放行白名单扩展名，且任何位置都不许出现 . 开头的段。
 */
export function isServableFile(rel: string): boolean {
  if (rel.includes('\\') || rel.includes('\0')) return false
  if (!rel || rel.startsWith('/')) return false
  const segments = rel.split('/')
  if (segments.some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.'))) return false
  if (!SERVABLE_PREFIXES.some((prefix) => rel.startsWith(prefix))) return false
  return mimeFor(rel) !== 'application/octet-stream'
}

/** 把一个相对键解析成绝对路径，越界直接抛错 */
export function resolveInside(root: string, rel: string): string {
  if (rel.includes('\0')) throw new Error('非法路径')
  const abs = path.resolve(root, rel)
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep
  if (abs !== root && !abs.startsWith(rootWithSep)) throw new Error(`路径越界：${rel}`)
  return abs
}

/** root 自己就是项目时（root/canvas.json 存在且 id 合法），返回它的 id；否则 null。 */
export function singleProjectId(root: string): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, 'canvas.json'), 'utf8')) as { id?: unknown }
    return isId(raw.id) ? raw.id : null
  } catch {
    return null
  }
}

/** 项目目录：默认 <root>/<项目 id>；根目录自己就是项目时就是 root。 */
export function projectDir(root: string, projectId: string): string {
  if (!isId(projectId)) throw new Error(`项目 id 不合法：${projectId}`)
  if (singleProjectId(root) === projectId) return root
  return path.join(root, projectId)
}

/** 统一成 POSIX 相对键 */
export function toRelPath(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/')
}
