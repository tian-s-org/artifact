/**
 * 路径规则集中在这里：项目根目录怎么找、什么能对外发、什么一律拒绝。
 * 画布组件里不允许出现绝对本地路径，所有路径到这里都还是 POSIX 相对键。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isId } from '../shared/canvas-schema'

/** 仓库根（artifact/）——服务端代码在 apps/local/server/ 下 */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

/** 默认项目目录：<repo>/projects，可用 ARTIFACT_PROJECTS 覆盖 */
export function projectsRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.ARTIFACT_PROJECTS
  return override ? path.resolve(override) : path.join(REPO_ROOT, 'projects')
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

export function projectDir(root: string, projectId: string): string {
  if (!isId(projectId)) throw new Error(`项目 id 不合法：${projectId}`)
  return path.join(root, projectId)
}

/** 统一成 POSIX 相对键 */
export function toRelPath(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/')
}
