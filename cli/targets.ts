/**
 * 技能要装到哪里：几个 Agent 的技能库 + 当前项目的 .claude/skills。
 *
 * 目标目录只描述「技能库根」，真正装进去的是 <根>/artifact-canvas。
 */
import os from 'node:os'
import path from 'node:path'

export type TargetId = 'claude' | 'omp' | 'project'

export interface SkillTarget {
  id: TargetId | 'custom'
  label: string
  /** 技能库根目录 */
  dir: string
}

export function skillTargets(cwd: string = process.cwd(), home: string = os.homedir()): SkillTarget[] {
  return [
    { id: 'claude', label: 'Claude Code（用户级）', dir: path.join(home, '.claude', 'skills') },
    { id: 'omp', label: 'omp（Oh-My-Pi）', dir: path.join(home, '.omp', 'agent', 'skills') },
    { id: 'project', label: '当前项目的 .claude/skills', dir: path.join(cwd, '.claude', 'skills') },
  ]
}

/** 'all' = 所有用户级技能库（不带 project：装进别人仓库的 .claude 目录不该是默认行为） */
export function resolveTargets(
  requested: string[],
  options: { cwd?: string; home?: string } = {},
): SkillTarget[] {
  const all = skillTargets(options.cwd, options.home)
  const ids = requested.length > 0 ? requested : ['claude']
  const picked: SkillTarget[] = []
  for (const id of ids) {
    if (id === 'all') {
      for (const target of all) if (target.id !== 'project') picked.push(target)
      continue
    }
    const found = all.find((target) => target.id === id)
    if (!found) throw new Error(`未知的安装目标：${id}（可选 claude / omp / project / all）`)
    picked.push(found)
  }
  return picked
}

export function customTarget(dir: string): SkillTarget {
  return { id: 'custom', label: dir, dir: path.resolve(dir) }
}
