import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CanvasError } from '@tian-s-org/schema'
import { FsProjectRepository } from '../../server/storage/project-repo'
import { FsVersionStore, VERSION_ID_RE } from '../../server/storage/versions'

async function withProject<T>(fn: (ctx: { root: string; dir: string; repo: FsProjectRepository; store: FsVersionStore }) => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-versions-'))
  try {
    const repo = new FsProjectRepository(root)
    await repo.createProject({ id: 'brand', name: 'Northstar' })
    await repo.addBoard('brand', { id: 'board-001', name: '品牌核心' })
    await repo.addBoard('brand', { id: 'board-002', name: '包装' })
    const store = new FsVersionStore(root)
    return await fn({ root, dir: path.join(root, 'brand'), repo, store })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

function boardPath(dir: string, boardId: string): string {
  return path.join(dir, 'artboards', boardId, 'index.html')
}

test('save 把画板和 layout.json 收进内容寻址的 blob', async () => {
  await withProject(async ({ dir, store }) => {
    const entry = await store.save('brand', '首版')
    assert.match(entry.id, VERSION_ID_RE)
    assert.equal(entry.note, '首版')
    assert.deepEqual(Object.keys(entry.boards).sort(), ['board-001', 'board-002'])
    assert.equal(entry.canvas.file, 'layout.json')

    const blobs = await fs.readdir(path.join(dir, 'versions', 'blobs'))
    assert.equal(blobs.length, 3, '两块画板 + layout.json 各一个 blob')

    const index = JSON.parse(await fs.readFile(path.join(dir, 'versions', 'index.json'), 'utf8')) as {
      versions: Array<{ id: string }>
    }
    assert.equal(index.versions[0]?.id, entry.id)
  })
})

test('同内容再存一版不会重复写 blob', async () => {
  await withProject(async ({ dir, store }) => {
    const first = await store.save('brand', '一')
    const second = await store.save('brand', '二')
    assert.notEqual(first.id, second.id)
    const blobs = await fs.readdir(path.join(dir, 'versions', 'blobs'))
    assert.equal(blobs.length, 3, '内容没变就不该多出 blob')
    const versions = await store.list('brand')
    assert.equal(versions.length, 2)
    assert.equal(versions[0]?.id, second.id, '新的排前面')
  })
})

test('只恢复一块画板：内容回旧，其他画板与 layout.json 不动', async () => {
  await withProject(async ({ dir, repo, store }) => {
    const saved = await store.save('brand', '改之前')
    const originalOne = await fs.readFile(boardPath(dir, 'board-001'), 'utf8')
    const originalTwo = await fs.readFile(boardPath(dir, 'board-002'), 'utf8')

    await fs.writeFile(boardPath(dir, 'board-001'), `${originalOne}<!-- 改过 -->\n`)
    await fs.writeFile(boardPath(dir, 'board-002'), `${originalTwo}<!-- 也改过 -->\n`)
    await repo.updateBoardPosition('brand', 'board-001', 900, 700)
    const canvasBefore = await fs.readFile(path.join(dir, 'layout.json'), 'utf8')

    const result = await store.restore('brand', saved.id, { boardId: 'board-001' })
    assert.deepEqual(result.restored, ['board-001'])
    assert.equal(await fs.readFile(boardPath(dir, 'board-001'), 'utf8'), originalOne)
    assert.ok((await fs.readFile(boardPath(dir, 'board-002'), 'utf8')).includes('也改过'), 'board-002 不该被动')
    assert.equal(await fs.readFile(path.join(dir, 'layout.json'), 'utf8'), canvasBefore, 'layout.json 不该被动')
  })
})

test('全量恢复会把 layout.json 一起还原', async () => {
  await withProject(async ({ dir, repo, store }) => {
    const saved = await store.save('brand', '排布定稿')
    const canvas = await fs.readFile(path.join(dir, 'layout.json'), 'utf8')
    await repo.updateBoardPosition('brand', 'board-002', 5000, 5000)
    assert.notEqual(await fs.readFile(path.join(dir, 'layout.json'), 'utf8'), canvas)

    await store.restore('brand', saved.id)
    assert.equal(await fs.readFile(path.join(dir, 'layout.json'), 'utf8'), canvas)
  })
})

test('全量恢复：内容和这一版一样就不写，别的画板 mtime 不动', async () => {
  await withProject(async ({ dir, store }) => {
    const saved = await store.save('brand', '一')
    const before = await fs.stat(boardPath(dir, 'board-002'))
    await new Promise((resolve) => setTimeout(resolve, 20)) // 让 mtime 有可分辨的差别
    await fs.writeFile(boardPath(dir, 'board-001'), '<!-- 手改 -->\n')

    const result = await store.restore('brand', saved.id)
    assert.deepEqual(result.restored.sort(), ['board-001', 'board-002'], '两块都算恢复目标')
    const after = await fs.stat(boardPath(dir, 'board-002'))
    assert.equal(after.mtimeMs, before.mtimeMs, '内容没变就不该重写，否则画布会白重载')
  })
})

test('恢复前自动留一份备份', async () => {
  await withProject(async ({ dir, store }) => {
    const saved = await store.save('brand', '正式版')
    await fs.writeFile(boardPath(dir, 'board-001'), '<!-- 手改 -->\n')

    const result = await store.restore('brand', saved.id)
    assert.match(result.backupId, VERSION_ID_RE)

    const versions = await store.list('brand')
    const backup = versions.find((entry) => entry.id === result.backupId)
    assert.ok(backup, '备份应该出现在版本列表里')
    assert.equal(backup.auto, true)
    assert.equal(backup.note, '恢复前自动备份')

    // 备份里存的是「手改」那份，恢复备份能把它拿回来
    await store.restore('brand', result.backupId)
    assert.equal(await fs.readFile(boardPath(dir, 'board-001'), 'utf8'), '<!-- 手改 -->\n')
  })
})

test('非法版本 id、不存在的版本、不存在的画板都被拒绝', async () => {
  await withProject(async ({ store }) => {
    const saved = await store.save('brand', '一')
    await assert.rejects(() => store.restore('brand', '../../etc/passwd'), (err: unknown) =>
      err instanceof CanvasError && err.code === 'invalid')
    await assert.rejects(() => store.restore('brand', 'v20200101-000000'), (err: unknown) =>
      err instanceof CanvasError && err.code === 'not-found')
    await assert.rejects(
      () => store.restore('brand', saved.id, { boardId: 'board-999' }),
      (err: unknown) => err instanceof CanvasError && err.code === 'not-found',
    )
  })
})

test('版本索引坏了给出可读错误，不误报成「没有版本」', async () => {
  await withProject(async ({ dir, store }) => {
    await fs.mkdir(path.join(dir, 'versions'), { recursive: true })
    await fs.writeFile(path.join(dir, 'versions', 'index.json'), '{ 坏 JSON')
    await assert.rejects(() => store.list('brand'), (err: unknown) =>
      err instanceof CanvasError && err.code === 'invalid')
  })
})
