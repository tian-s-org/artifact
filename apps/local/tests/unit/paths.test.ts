import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { isServableFile, mimeFor, projectDir, projectsRoot, resolveInside, singleProjectId } from '../../server/paths'

test('只放行三个顶层目录和白名单扩展名', () => {
  const allowed = [
    'artboards/board-001/index.html',
    'artboards/board-001/style.css',
    'assets/images/hero.png',
    'assets/fonts/inter.woff2',
    'design-system/tokens.json',
  ]
  for (const rel of allowed) assert.equal(isServableFile(rel), true, rel)

  const denied = [
    'canvas.json',
    'context.md',
    'versions/index.json',
    'design-system/guidelines.md',
    'artboards/board-001/.secret.html',
    'artboards/board-001/app.js',
    'artboards/../../canvas.json',
    'artboards/board-001/../../canvas.json',
    '/artboards/board-001/index.html',
    'artboards//board-001/index.html',
    '',
  ]
  for (const rel of denied) assert.equal(isServableFile(rel), false, rel)
})

test('Windows 分隔符与反斜杠一律拒绝', () => {
  assert.equal(isServableFile('artboards\\board-001\\index.html'), false)
})

test('mimeFor 认得画板用到的类型', () => {
  assert.equal(mimeFor('a/index.html'), 'text/html; charset=utf-8')
  assert.equal(mimeFor('a/x.svg'), 'image/svg+xml')
  assert.equal(mimeFor('a/x.woff2'), 'font/woff2')
  assert.equal(mimeFor('a/x.unknown'), 'application/octet-stream')
})

test('resolveInside 拒绝越界', () => {
  const root = path.resolve('/tmp/artifact-root')
  assert.equal(resolveInside(root, 'artboards/index.html'), path.join(root, 'artboards/index.html'))
  assert.throws(() => resolveInside(root, '../etc/passwd'))
  assert.throws(() => resolveInside(root, '/etc/passwd'))
})

test('根目录自己就是项目：singleProjectId 与 projectDir', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-flat-'))
  try {
    await fs.writeFile(
      path.join(dir, 'canvas.json'),
      JSON.stringify({ protocol: 1, id: 'skillbor', name: 'x', boards: [] }),
    )
    assert.equal(singleProjectId(dir), 'skillbor', '根下的 canvas.json 就是项目本身')
    assert.equal(projectDir(dir, 'skillbor'), dir, '项目目录就是根，不再套一层')
    assert.equal(projectDir(dir, 'other'), path.join(dir, 'other'), '别的 id 仍按子目录找')

    await fs.writeFile(path.join(dir, 'canvas.json'), '{oops')
    assert.equal(singleProjectId(dir), null, '坏 JSON 不算单项目根')
    assert.equal(projectDir(dir, 'skillbor'), path.join(dir, 'skillbor'))
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('projectsRoot 支持 ARTIFACT_PROJECTS 覆盖', () => {
  const overridden = projectsRoot({ ARTIFACT_PROJECTS: '/tmp/some-projects' } as NodeJS.ProcessEnv)
  assert.equal(overridden, path.resolve('/tmp/some-projects'))
  const fallback = projectsRoot({} as NodeJS.ProcessEnv)
  assert.ok(fallback.endsWith('/projects'))
})
