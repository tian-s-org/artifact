import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { FsProjectRepository, ProjectExistsError } from '../../server/storage/project-repo'

async function withTempRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-repo-'))
  try {
    return await fn(root)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

test('createProject 建出 canvas.json、context.md 和设计规范骨架', async () => {
  await withTempRoot(async (root) => {
    const repo = new FsProjectRepository(root)
    const doc = await repo.createProject({ id: 'brand', name: 'Northstar' })
    assert.equal(doc.id, 'brand')
    assert.equal(doc.protocol, 1)
    assert.deepEqual(doc.boards, [])

    for (const rel of ['canvas.json', 'context.md', 'design-system/guidelines.md', 'design-system/tokens.json']) {
      const stat = await fs.stat(path.join(root, 'brand', rel))
      assert.ok(stat.isFile(), rel)
    }
    await assert.rejects(() => repo.createProject({ id: 'brand', name: '再来一次' }), ProjectExistsError)
  })
})

test('addBoard 写回 canvas.json 并生成骨架 HTML', async () => {
  await withTempRoot(async (root) => {
    const repo = new FsProjectRepository(root)
    await repo.createProject({ id: 'brand', name: 'Northstar' })

    const first = await repo.addBoard('brand', { id: 'board-001', name: '品牌核心' })
    assert.equal(first.x, 0)
    assert.equal(first.order, 1)

    const second = await repo.addBoard('brand', { id: 'board-002', name: '色彩', width: 1024, height: 768 })
    assert.equal(second.x, 1440 + 160)
    assert.equal(second.width, 1024)
    assert.equal(second.order, 2)

    const html = await fs.readFile(path.join(root, 'brand', 'artboards/board-002/index.html'), 'utf8')
    assert.ok(html.includes('色彩'))
    assert.ok(html.includes('1024 × 768'))

    const doc = JSON.parse(await fs.readFile(path.join(root, 'brand', 'canvas.json'), 'utf8'))
    assert.equal(doc.boards.length, 2)

    await assert.rejects(() => repo.addBoard('brand', { id: 'board-001', name: '重复' }), /画板已存在/)
    await assert.rejects(() => repo.addBoard('brand', { id: 'Board 3', name: '非法' }))
  })
})

test('updateBoardPosition 只改坐标，坐标取整', async () => {
  await withTempRoot(async (root) => {
    const repo = new FsProjectRepository(root)
    await repo.createProject({ id: 'brand', name: 'Northstar' })
    await repo.addBoard('brand', { id: 'board-001', name: 'A' })
    const board = await repo.updateBoardPosition('brand', 'board-001', 120.7, -40.2)
    assert.equal(board.x, 121)
    assert.equal(board.y, -40)
    await assert.rejects(() => repo.updateBoardPosition('brand', 'board-999', 0, 0), /画板不存在/)
    await assert.rejects(() => repo.updateBoardPosition('brand', 'board-001', Number.NaN, 0))
  })
})

test('并发写回不会互相覆盖（同一项目串行）', async () => {
  await withTempRoot(async (root) => {
    const repo = new FsProjectRepository(root)
    await repo.createProject({ id: 'brand', name: 'Northstar' })
    for (let i = 1; i <= 12; i++) {
      await repo.addBoard('brand', { id: `board-${String(i).padStart(3, '0')}`, name: `画板 ${i}` })
    }
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        repo.updateBoardPosition('brand', `board-${String(i + 1).padStart(3, '0')}`, i * 10, i * 20),
      ),
    )
    const doc = await repo.getProject('brand')
    for (let i = 0; i < 12; i++) {
      assert.equal(doc.boards[i]?.x, i * 10, `board ${i + 1} 的 x`)
      assert.equal(doc.boards[i]?.y, i * 20, `board ${i + 1} 的 y`)
    }
  })
})

test('canvas.json 非法时 getProject 抛出带 code 的错误', async () => {
  await withTempRoot(async (root) => {
    const repo = new FsProjectRepository(root)
    await repo.createProject({ id: 'brand', name: 'Northstar' })
    await fs.writeFile(path.join(root, 'brand', 'canvas.json'), '{ oops')
    await assert.rejects(() => repo.getProject('brand'), SyntaxError)
    await fs.writeFile(path.join(root, 'brand', 'canvas.json'), JSON.stringify({ protocol: 1, id: 'brand', name: 'x', boards: [{ id: '../x' }] }))
    await assert.rejects(() => repo.getProject('brand'), /boards\[0\]/)
  })
})

test('listProjects 跳过坏项目', async () => {
  await withTempRoot(async (root) => {
    const repo = new FsProjectRepository(root)
    await repo.createProject({ id: 'brand', name: 'Northstar' })
    await fs.mkdir(path.join(root, 'broken'), { recursive: true })
    await fs.writeFile(path.join(root, 'broken', 'canvas.json'), 'nothing here')
    await fs.mkdir(path.join(root, 'not-a-project'), { recursive: true })
    const list = await repo.listProjects()
    assert.deepEqual(list.map((p) => p.id), ['brand'])
    assert.equal(list[0]?.boardCount, 0)
  })
})
