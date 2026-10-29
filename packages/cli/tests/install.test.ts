import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { findRepoRoot, resolveCanvas } from '../src/canvas'
import { installSkill, installedInfo, MARKER, SKILL_NAME } from '../src/install'
import { customTarget, resolveTargets, skillTargets } from '../src/targets'

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

function firstTarget(home: string, id = 'claude'): ReturnType<typeof resolveTargets>[number] {
  const target = resolveTargets([id], { home })[0]
  if (!target) throw new Error(`解析不到目标 ${id}`)
  return target
}

test('装进技能库：文件齐、标记写对，重复装是 unchanged', async () => {
  const home = await tempDir('artifact-cli-home-')
  try {
    const target = firstTarget(home)
    const first = await installSkill(target)
    assert.equal(first.action, 'installed')
    assert.equal(path.dirname(first.dest), target.dir)
    assert.ok(first.files >= 2, 'SKILL.md 与 references 都要拷过去')

    const skillFile = await fs.readFile(path.join(first.dest, 'SKILL.md'), 'utf8')
    assert.match(skillFile, /^---\nname: artifact-canvas/, '技能文件要有 frontmatter')

    const marker = JSON.parse(await fs.readFile(path.join(first.dest, MARKER), 'utf8')) as {
      version: string
      files: number
    }
    assert.match(marker.version, /^\d+\.\d+\.\d+/)
    assert.equal(marker.files, first.files)

    const second = await installSkill(target)
    assert.equal(second.action, 'unchanged', '内容一致就不该再写一遍')
  } finally {
    await fs.rm(home, { recursive: true, force: true })
  }
})

test('目标被人改过：不加 --force 拒绝，加了才覆盖', async () => {
  const home = await tempDir('artifact-cli-home-')
  try {
    const target = firstTarget(home)
    const first = await installSkill(target)
    const edited = path.join(first.dest, 'SKILL.md')
    await fs.writeFile(edited, '我自己改的\n')

    await assert.rejects(() => installSkill(target), /--force/)
    assert.equal(await fs.readFile(edited, 'utf8'), '我自己改的\n', '拒绝时不能动目标文件')

    const forced = await installSkill(target, { force: true })
    assert.equal(forced.action, 'updated')
    assert.match(await fs.readFile(edited, 'utf8'), /^---\nname: artifact-canvas/)
  } finally {
    await fs.rm(home, { recursive: true, force: true })
  }
})

test('installedInfo 能读出装的是哪一版；没装返回 null', async () => {
  const home = await tempDir('artifact-cli-home-')
  try {
    const target = firstTarget(home)
    assert.equal(await installedInfo(target), null)
    await installSkill(target)
    const info = await installedInfo(target)
    assert.ok(info)
    assert.match(info.version, /^\d+\.\d+\.\d+/)
    assert.ok(info.installedAt !== '')
  } finally {
    await fs.rm(home, { recursive: true, force: true })
  }
})

test('目标解析：默认 claude，all 只含用户级，未知 id 报错，--dir 覆盖', async () => {
  const cwd = '/tmp/project-x'
  const home = '/tmp/home-x'
  assert.deepEqual(
    resolveTargets([], { cwd, home }).map((t) => t.id),
    ['claude'],
  )
  assert.deepEqual(
    resolveTargets(['all'], { cwd, home }).map((t) => t.id),
    ['claude', 'omp'],
    'project 不该被 all 带进来',
  )
  assert.equal(resolveTargets(['project'], { cwd, home })[0]?.dir, path.join(cwd, '.claude', 'skills'))
  assert.throws(() => resolveTargets(['vscode'], { cwd, home }), /未知的安装目标/)

  const custom = customTarget('/tmp/my-skills')
  assert.equal(custom.dir, '/tmp/my-skills')

  const labels = skillTargets(cwd, home).map((t) => t.label)
  assert.equal(labels.length, 3)
  assert.equal(SKILL_NAME, 'artifact-canvas')
})

test('找仓库与解析画布参数', async () => {
  const repo = findRepoRoot(path.join(process.cwd(), 'src'))
  assert.ok(repo, '从 packages/cli/src 往上应该能找到 artifact 仓库')
  const resolved = resolveCanvas({ repo })
  assert.equal(resolved.bin, path.join(repo, 'apps', 'local', 'bin', 'artifact-canvas.mjs'))
  assert.equal(resolved.projects, path.join(repo, 'projects'))

  const empty = await tempDir('artifact-cli-empty-')
  try {
    assert.equal(findRepoRoot(empty), null)
    assert.throws(() => resolveCanvas({ repo: empty }), /不像 artifact 仓库/)
  } finally {
    await fs.rm(empty, { recursive: true, force: true })
  }
})
