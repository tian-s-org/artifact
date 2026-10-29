#!/usr/bin/env node
/**
 * artifact CLI
 *
 *   artifact-cli skill install [--target claude|omp|project|all] [--dir <技能库根>] [--force]
 *   artifact-cli skill list
 *   artifact-cli canvas [--projects <项目根>] [--port 4330] [--repo <artifact 仓库>]
 */
import { cliVersion, installSkill, installedInfo, SKILL_NAME } from './install'
import { customTarget, resolveTargets, skillTargets } from './targets'
import { resolveCanvas, runCanvas } from './canvas'

const USAGE = `artifact-cli —— Agent 原生设计画布的命令行

用法：
  artifact-cli skill install [--target claude|omp|project|all] [--dir <技能库根>] [--force]
      把「${SKILL_NAME}」技能装进本地 Agent 技能库（默认 claude，all = 所有用户级技能库）
  artifact-cli skill list
      看每个技能库装没装、装的是哪一版
  artifact-cli canvas [--projects <项目根>] [--port 4330] [--repo <artifact 仓库>]
      起本地画布；项目根默认当前目录的 .artifact/，仓库里调试时用 --repo

示例：
  npx @tian-s-org/artifact-cli skill install
  npx @tian-s-org/artifact-cli skill install --target all --force
  npx @tian-s-org/artifact-cli canvas            # 默认读 ./.artifact

（发布在 GitHub Packages：@tian-s-org/artifact-cli。没配 registry 时用仓库里的 packages/cli。）`

interface Parsed {
  command: string[]
  flags: Map<string, string | true>
}

function parse(argv: string[]): Parsed {
  const command: string[] = []
  const flags = new Map<string, string | true>()
  const valued = new Set(['target', 'dir', 'repo', 'projects', 'port'])
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? ''
    if (arg.startsWith('--')) {
      const [name, inline] = arg.slice(2).split('=', 2)
      if (!name) throw new Error(`参数不合法：${arg}`)
      if (inline !== undefined) flags.set(name, inline)
      else if (valued.has(name)) flags.set(name, argv[++i] ?? '')
      else flags.set(name, true)
    } else {
      command.push(arg)
    }
  }
  return { command, flags }
}

function stringFlag(parsed: Parsed, name: string): string | undefined {
  const value = parsed.flags.get(name)
  return typeof value === 'string' && value !== '' ? value : undefined
}

async function skillInstall(parsed: Parsed): Promise<number> {
  const requested = (stringFlag(parsed, 'target') ?? 'claude').split(',').map((s) => s.trim()).filter(Boolean)
  const dir = stringFlag(parsed, 'dir')
  const targets = dir ? [customTarget(dir)] : resolveTargets(requested)
  const force = parsed.flags.get('force') === true

  let failed = 0
  for (const target of targets) {
    try {
      const result = await installSkill(target, { force })
      const verb = result.action === 'installed' ? '已安装' : result.action === 'updated' ? '已更新' : '已是最新'
      console.log(`${verb} ${SKILL_NAME} → ${result.dest}（${result.files} 个文件）`)
      if (result.action !== 'unchanged') console.log(`  ${target.label}：新开一个会话后生效`)
    } catch (err) {
      failed++
      console.error(`失败：${(err as Error).message}`)
    }
  }
  return failed === 0 ? 0 : 1
}

async function skillList(): Promise<number> {
  const version = await cliVersion()
  console.log(`artifact CLI ${version}，技能 ${SKILL_NAME}`)
  for (const target of skillTargets()) {
    const info = await installedInfo(target)
    const state = info ? `已安装 ${info.version}${info.installedAt ? ` · ${info.installedAt.slice(0, 10)}` : ''}` : '未安装'
    console.log(`  ${target.id.padEnd(8)} ${state.padEnd(28)} ${target.dir}`)
  }
  return 0
}

async function canvas(parsed: Parsed): Promise<number> {
  const portRaw = stringFlag(parsed, 'port')
  const port = portRaw === undefined ? undefined : Number(portRaw)
  if (port !== undefined && (!Number.isInteger(port) || port <= 0 || port > 65535)) {
    throw new Error(`端口不合法：${portRaw}`)
  }
  const resolved = resolveCanvas({ repo: stringFlag(parsed, 'repo'), projects: stringFlag(parsed, 'projects') })
  console.log(resolved.label)
  console.log(`项目  ${resolved.projects ?? '（当前目录的 .artifact/）'}`)
  return runCanvas(resolved, port)
}

export async function main(argv: string[]): Promise<void> {
  try {
    if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
      console.log(USAGE)
      return
    }
    if (argv[0] === '--version' || argv[0] === '-v') {
      console.log(await cliVersion())
      return
    }

    const parsed = parse(argv)
    const [group, action] = parsed.command

    if (group === 'skill' && action === 'install') process.exitCode = await skillInstall(parsed)
    else if (group === 'skill' && (action === 'list' || action === undefined)) process.exitCode = await skillList()
    else if (group === 'canvas') process.exitCode = await canvas(parsed)
    else throw new Error(`未知命令：${parsed.command.join(' ')}（artifact-cli --help 看用法）`)
  } catch (err) {
    console.error(`错误：${(err as Error).message}`)
    process.exitCode = 1
  }
}
