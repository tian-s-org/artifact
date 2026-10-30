#!/usr/bin/env node
/**
 * artifact CLI
 *
 *   artifact login [--url <地址>]        浏览器授权，token 存本机
 *   artifact logout
 *   artifact push [目录] [--url <地址>]
 *   artifact open [--url <地址>]
 *   artifact skill install / list
 */
import { spawn } from 'node:child_process'
import { clearCredentials, readCredentials } from './credentials'
import { cliVersion, installSkill, installedInfo, SKILL_NAME } from './install'
import { login } from './login'
import { push } from './push'
import { customTarget, resolveTargets, skillTargets } from './targets'

const DEFAULT_URL = process.env.ARTIFACT_URL ?? 'https://artifact.tianyw0.xyz'

const USAGE = `artifact —— 画布命令行

用法：
  artifact login [--url <地址>]
      打开浏览器授权（Google 登录），token 存到 ~/.config/artifact/credentials.json
  artifact logout
      删掉本机 token
  artifact push [目录] [--url <地址>]
      把本地 .artifact/ 整包推到云端（默认当前目录的 .artifact）
  artifact open [--url <地址>]
      在浏览器里打开画布
  artifact skill install [--target claude|omp|project|all] [--dir <技能库根>] [--force]
      把「${SKILL_NAME}」技能装进本地 Agent 技能库（默认 claude，all = 所有用户级技能库）
  artifact skill list
      看每个技能库装没装、装的是哪一版

环境变量：
  ARTIFACT_URL   画布地址（默认 ${DEFAULT_URL}）
  ARTIFACT_KEY   CLI token；不设就用 artifact login 存下来的

示例：
  npx @tian-s-org/canvas login
  npx @tian-s-org/canvas push
  npx @tian-s-org/canvas open`

interface Parsed {
  command: string[]
  flags: Map<string, string | true>
}

function parse(argv: string[]): Parsed {
  const command: string[] = []
  const flags = new Map<string, string | true>()
  const valued = new Set(['target', 'dir', 'url', 'key'])
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

function openUrl(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref()
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
    const creds = await readCredentials()
    const url = stringFlag(parsed, 'url') ?? process.env.ARTIFACT_URL ?? creds?.url ?? DEFAULT_URL

    if (group === 'login') {
      await login({ url })
    } else if (group === 'logout') {
      await clearCredentials()
      console.log('已删除本机 token')
    } else if (group === 'push') {
      const key = stringFlag(parsed, 'key') ?? process.env.ARTIFACT_KEY ?? creds?.token
      try {
        await push({ dir: action, url, key })
      } catch (err) {
        if (!key) throw new Error(`${(err as Error).message}（还没登录？先跑 artifact login）`)
        throw err
      }
    } else if (group === 'open') {
      openUrl(url)
    } else if (group === 'skill' && action === 'install') {
      process.exitCode = await skillInstall(parsed)
    } else if (group === 'skill' && (action === 'list' || action === undefined)) {
      process.exitCode = await skillList()
    } else {
      throw new Error(`未知命令：${parsed.command.join(' ')}（artifact --help 看用法）`)
    }
  } catch (err) {
    console.error(`错误：${(err as Error).message}`)
    process.exitCode = 1
  }
}
