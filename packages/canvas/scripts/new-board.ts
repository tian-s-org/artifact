#!/usr/bin/env node
/**
 * Agent 侧新建画板。
 *
 *   pnpm new-board brand "包装刀版线"
 *   pnpm new-board brand "方案 C" --id board-004 --size 1440x900
 *
 * 直接读写项目目录（不依赖服务在跑）：改完 layout.json 与骨架 HTML 后，
 * 正在运行的画布会通过文件监听自己刷新。
 */
import path from 'node:path'
import { isId } from '@tian-s-org/schema'
import { projectsRoot, REPO_ROOT } from '../server/paths'
import { FsProjectRepository } from '../server/storage/project-repo'

interface Parsed {
  projectId: string
  name: string
  id?: string
  width?: number
  height?: number
}

function usage(msg?: string): never {
  if (msg) console.error(`错误：${msg}\n`)
  console.error(`用法：pnpm new-board <项目 id> <画板名称> [--id board-00N] [--size 1440x900]

示例：
  pnpm new-board brand "包装刀版线"
  pnpm new-board architecture "部署拓扑" --size 1600x1000`)
  process.exit(1)
}

function parseArgs(argv: string[]): Parsed {
  const positional: string[] = []
  let id: string | undefined
  let width: number | undefined
  let height: number | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ''
    if (arg === '--id') {
      id = argv[++i]
    } else if (arg.startsWith('--id=')) {
      id = arg.slice('--id='.length)
    } else if (arg === '--size') {
      ;[width, height] = parseSize(argv[++i] ?? '')
    } else if (arg.startsWith('--size=')) {
      ;[width, height] = parseSize(arg.slice('--size='.length))
    } else if (arg.startsWith('-')) {
      usage(`未知参数 ${arg}`)
    } else {
      positional.push(arg)
    }
  }
  const [projectId, name] = positional
  if (!projectId || !name) usage('缺少项目 id 或画板名称')
  if (!isId(projectId)) usage(`项目 id 不合法：${projectId}`)
  return { projectId, name, id, width, height }
}

function parseSize(value: string): [number | undefined, number | undefined] {
  const match = /^(\d+)[x×*](\d+)$/.exec(value)
  if (!match) usage(`尺寸格式应为 1440x900，收到 ${value}`)
  return [Number(match[1]), Number(match[2])]
}

async function main(): Promise<void> {
  const { projectId, name, id, width, height } = parseArgs(process.argv.slice(2))
  const root = projectsRoot()
  const repo = new FsProjectRepository(root)

  const doc = await repo.getProject(projectId)
  const boardId = id ?? nextBoardId(doc.boards.map((b) => b.id))
  const board = await repo.addBoard(projectId, { id: boardId, name, width, height })

  console.log(`已新建画板 ${board.id}「${board.name}」`)
  console.log(`  位置    x=${board.x} y=${board.y}  ${board.width}×${board.height}`)
  console.log(`  文件    ${path.relative(REPO_ROOT, path.join(root, projectId, board.file))}`)
  console.log('\n下一步：直接编辑上面这个 HTML 文件，画布会自动刷新。')
}

function nextBoardId(existing: string[]): string {
  let max = 0
  for (const id of existing) {
    const match = /^board-(\d+)$/.exec(id)
    if (match?.[1]) max = Math.max(max, Number(match[1]))
  }
  return `board-${String(max + 1).padStart(3, '0')}`
}

main().catch((err) => {
  console.error(`失败：${(err as Error).message}`)
  process.exit(1)
})
