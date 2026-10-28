/**
 * 把 skills/artifact-canvas 整棵拷进目标技能库。
 *
 * 三种结果：
 * - installed：目标里没有，写进去；
 * - unchanged：内容与来源逐字节一致，什么都不做（重复执行安全）；
 * - updated：目标里有旧版本或被人改过，加 --force 才覆盖。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SkillTarget } from './targets'

export const SKILL_NAME = 'artifact-canvas'
/** 技能来源目录（本包内的 skills/） */
export const SKILL_ROOT = fileURLToPath(new URL('../skills/', import.meta.url))
/** 标记文件：记录装的是哪一版、什么时候装的 */
export const MARKER = '.artifact-skill.json'

export interface InstallResult {
  target: SkillTarget
  dest: string
  action: 'installed' | 'updated' | 'unchanged'
  files: number
}

export interface InstalledInfo {
  version: string
  installedAt: string
  files: number
}

interface FileEntry {
  rel: string
  data: Buffer
}

export async function cliVersion(): Promise<string> {
  const raw = await fs.readFile(new URL('../package.json', import.meta.url), 'utf8')
  return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0'
}

async function readTree(dir: string, base: string = dir): Promise<FileEntry[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files: FileEntry[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await readTree(abs, base)))
    } else if (entry.isFile()) {
      files.push({ rel: path.relative(base, abs).split(path.sep).join('/'), data: await fs.readFile(abs) })
    }
  }
  return files
}

/** 目标目录不在就返回 null；在就把文件读出来（不含标记文件） */
async function readExisting(dir: string): Promise<FileEntry[] | null> {
  try {
    const stat = await fs.stat(dir)
    if (!stat.isDirectory()) return null
  } catch {
    return null
  }
  return (await readTree(dir)).filter((file) => file.rel !== MARKER)
}

function sameFiles(a: FileEntry[], b: FileEntry[]): boolean {
  if (a.length !== b.length) return false
  const byRel = new Map(b.map((file) => [file.rel, file.data]))
  return a.every((file) => {
    const other = byRel.get(file.rel)
    return other !== undefined && other.equals(file.data)
  })
}

async function writeTree(dest: string, files: FileEntry[], version: string): Promise<void> {
  for (const file of files) {
    const abs = path.join(dest, file.rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, file.data)
  }
  const marker: InstalledInfo = { version, installedAt: new Date().toISOString(), files: files.length }
  await fs.writeFile(path.join(dest, MARKER), `${JSON.stringify(marker, null, 2)}\n`)
}

export async function installSkill(
  target: SkillTarget,
  options: { force?: boolean; version?: string } = {},
): Promise<InstallResult> {
  const source = await readTree(path.join(SKILL_ROOT, SKILL_NAME))
  if (source.length === 0) throw new Error(`技能来源是空的：${path.join(SKILL_ROOT, SKILL_NAME)}`)
  const version = options.version ?? (await cliVersion())
  const dest = path.join(target.dir, SKILL_NAME)
  const existing = await readExisting(dest)

  if (existing === null) {
    await writeTree(dest, source, version)
    return { target, dest, action: 'installed', files: source.length }
  }
  if (sameFiles(source, existing)) return { target, dest, action: 'unchanged', files: source.length }
  if (!options.force) {
    throw new Error(`${dest} 已存在且内容不同，确认覆盖请加 --force`)
  }
  await writeTree(dest, source, version)
  return { target, dest, action: 'updated', files: source.length }
}

/** 读标记文件：没装过返回 null */
export async function installedInfo(target: SkillTarget): Promise<InstalledInfo | null> {
  const dest = path.join(target.dir, SKILL_NAME)
  try {
    const raw = await fs.readFile(path.join(dest, MARKER), 'utf8')
    return JSON.parse(raw) as InstalledInfo
  } catch {
    try {
      await fs.access(path.join(dest, 'SKILL.md'))
      return { version: '未知', installedAt: '', files: 0 }
    } catch {
      return null
    }
  }
}
