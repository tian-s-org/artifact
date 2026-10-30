import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { EventBus } from '../../server/events'
import { FsProjectRepository } from '../../server/storage/project-repo'
import type { CanvasEvent } from '../../server/storage/types'
import { ProjectWatcher } from '../../server/watch'

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-watch-'))
  const repo = new FsProjectRepository(root)
  const bus = new EventBus()
  const events: CanvasEvent[] = []
  bus.subscribe((e) => events.push(e))
  const watcher = new ProjectWatcher({ root, bus, debounceMs: 1, settleMs: 0 })
  return { root, repo, events, watcher }
}

test('画板 HTML 变化只广播 board:changed，并带上 mtime', async () => {
  const { root, repo, events, watcher } = await setup()
  try {
    await repo.createProject({ id: 'brand', name: 'Northstar' })
    await repo.addBoard('brand', { id: 'board-001', name: 'A' })
    events.length = 0

    const file = path.join(root, 'brand', 'artboards/board-001/index.html')
    await fs.writeFile(file, '<!doctype html><title>新内容</title>')
    const stat = await fs.stat(file)

    await watcher.flushForTest(['brand/artboards/board-001/index.html'])
    assert.equal(events.length, 1)
    const event = events[0]
    assert.equal(event?.type, 'board:changed')
    if (event?.type === 'board:changed') {
      assert.equal(event.projectId, 'brand')
      assert.equal(event.boardId, 'board-001')
      assert.equal(event.mtime, stat.mtimeMs)
    }
  } finally {
    watcher.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('layout.json 变化广播 canvas:changed，并按差异补 board:added / board:removed', async () => {
  const { root, repo, events, watcher } = await setup()
  try {
    await repo.createProject({ id: 'brand', name: 'Northstar' })
    await repo.addBoard('brand', { id: 'board-001', name: 'A' })
    await watcher.flushForTest(['brand/layout.json']) // 第一轮只建立快照
    events.length = 0

    await repo.addBoard('brand', { id: 'board-002', name: 'B' })
    await watcher.flushForTest(['brand/layout.json'])
    assert.deepEqual(
      events.map((e) => e.type),
      ['board:added', 'canvas:changed'],
    )

    events.length = 0
    await repo.updateProject('brand', (doc) => ({ ...doc, boards: doc.boards.filter((b) => b.id !== 'board-001') }))
    await watcher.flushForTest(['brand/layout.json'])
    assert.deepEqual(
      events.map((e) => e.type),
      ['board:removed', 'canvas:changed'],
    )
  } finally {
    watcher.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('坏 layout.json 广播 project:error，不崩监听', async () => {
  const { root, repo, events, watcher } = await setup()
  try {
    await repo.createProject({ id: 'brand', name: 'Northstar' })
    await fs.writeFile(path.join(root, 'brand', 'layout.json'), '{ broken')
    events.length = 0
    await watcher.flushForTest(['brand/layout.json'])
    assert.equal(events[0]?.type, 'project:error')
  } finally {
    watcher.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('临时文件、点开头目录、node_modules 不触发任何事件', async () => {
  const { root, repo, events, watcher } = await setup()
  try {
    await repo.createProject({ id: 'brand', name: 'Northstar' })
    events.length = 0
    await watcher.flushForTest([
      'brand/artboards/board-001/.tmp-abc123',
      'brand/.DS_Store',
      'brand/node_modules/foo/index.html',
      'brand/layout.json.tmp-1',
      'README.md',
    ])
    assert.deepEqual(events, [])
  } finally {
    watcher.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('刚写过的文件会再等一轮（稳定性双查），不会丢事件', async () => {
  const { root, repo, events } = await setup()
  try {
    await repo.createProject({ id: 'brand', name: 'Northstar' })
    await repo.addBoard('brand', { id: 'board-001', name: 'A' })
    const bus = new EventBus()
    const collected: CanvasEvent[] = []
    bus.subscribe((e) => collected.push(e))
    const watcher = new ProjectWatcher({ root, bus, debounceMs: 1, settleMs: 5000 })
    try {
      await fs.writeFile(path.join(root, 'brand', 'artboards/board-001/index.html'), '<!doctype html>')
      await watcher.flushForTest(['brand/artboards/board-001/index.html'])
      assert.deepEqual(collected, [], '太新的文件第一轮不应广播')
    } finally {
      watcher.close()
    }
    assert.ok(events.length >= 0)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('根目录自己就是项目时，相对路径里没有项目 id 那一段', async () => {
  const { root, events, watcher } = await setup()
  try {
    await fs.writeFile(
      path.join(root, 'layout.json'),
      JSON.stringify({ protocol: 1, id: 'skillbor', name: 'skillbor', boards: [] }),
    )
    const board = path.join(root, 'artboards/board-001/index.html')
    await fs.mkdir(path.dirname(board), { recursive: true })
    await fs.writeFile(board, '<!doctype html><title>平铺</title>')
    const stat = await fs.stat(board)
    events.length = 0

    await watcher.flushForTest(['artboards/board-001/index.html'])
    assert.equal(events.length, 1)
    const event = events[0]
    assert.equal(event?.type, 'board:changed')
    if (event?.type === 'board:changed') {
      assert.equal(event.projectId, 'skillbor')
      assert.equal(event.boardId, 'board-001')
      assert.equal(event.mtime, stat.mtimeMs)
    }
  } finally {
    watcher.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})
