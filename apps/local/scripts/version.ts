#!/usr/bin/env node
/**
 * Agent / 终端侧的版本操作，直接读写项目目录（不依赖服务在跑）。
 *
 *   pnpm versions save brand "配色定稿"
 *   pnpm versions list brand
 *   pnpm versions restore brand v20261029-073000
 *   pnpm versions restore brand v20261029-073000 --board board-001
 *
 * 只恢复单块画板时不会动 canvas.json 和其他画板；恢复前会自动存一份备份。
 */
import path from 'node:path'
import { isId } from '@tian-s-org/schema'
import { projectsRoot, REPO_ROOT } from '../server/paths'
import { FsVersionStore, type VersionEntry } from '../server/storage/versions'

function usage(msg?: string): never {
  if (msg) console.error(`错误：${msg}\n`)
  console.error(`用法：
  pnpm versions save <项目 id> <备注>
  pnpm versions list <项目 id>
  pnpm versions restore <项目 id> <版本 id> [--board board-001]

示例：
  pnpm versions save brand "配色定稿"
  pnpm versions restore brand v20261029-073000 --board board-001`)
  process.exit(1)
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function printEntry(entry: VersionEntry): void {
  const boards = Object.keys(entry.boards).length
  const tag = entry.auto ? '（自动）' : ''
  console.log(`${entry.id}  ${formatTime(entry.at)}  ${boards} 块画板  ${entry.note}${tag}`)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const positional: string[] = []
  let boardId: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ''
    if (arg === '--board') boardId = argv[++i]
    else if (arg.startsWith('--board=')) boardId = arg.slice('--board='.length)
    else if (arg.startsWith('-')) usage(`未知参数 ${arg}`)
    else positional.push(arg)
  }

  const [command, projectId, extra] = positional
  if (!command || !projectId) usage('缺少子命令或项目 id')
  if (!isId(projectId)) usage(`项目 id 不合法：${projectId}`)
  if (boardId !== undefined && !isId(boardId)) usage(`画板 id 不合法：${boardId}`)

  const root = projectsRoot()
  const store = new FsVersionStore(root)
  const absolute = path.join(root, projectId)
  const relative = path.relative(REPO_ROOT, absolute)
  // 项目目录通常在仓库里，打印相对路径；用 ARTIFACT_PROJECTS 指到外面时就打绝对路径
  const shownDir = relative.startsWith('..') ? absolute : relative

  if (command === 'save') {
    const entry = await store.save(projectId, extra ?? '')
    console.log(`已保存版本 ${entry.id}（${Object.keys(entry.boards).length} 块画板）`)
    console.log(`  目录  ${shownDir}/versions`)
    console.log(`  备注  ${entry.note}`)
    return
  }

  if (command === 'list') {
    const versions = await store.list(projectId)
    if (versions.length === 0) {
      console.log('还没有保存过版本。用 pnpm versions save 存一版。')
      return
    }
    for (const entry of versions) printEntry(entry)
    return
  }

  if (command === 'restore') {
    if (!extra) usage('restore 需要版本 id')
    const result = await store.restore(projectId, extra, boardId ? { boardId } : {})
    console.log(`已恢复到 ${result.version.id}（${result.version.note}）`)
    console.log(`  写回画板  ${result.restored.join(', ') || '（只恢复了 canvas.json）'}`)
    console.log(`  恢复前备份  ${result.backupId}`)
    if (boardId) console.log('  只动了这一块画板，canvas.json 与其他画板保持原样。')
    return
  }

  usage(`未知子命令 ${command}`)
}

main().catch((err) => {
  console.error(`失败：${(err as Error).message}`)
  process.exit(1)
})
