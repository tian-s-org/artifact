/**
 * 版本管理：面板保存 → 改画板 → 恢复 → 内容回旧、他板不动、恢复前留了自动备份。
 * 走的是真实面板与真实 fs，恢复结果直接读磁盘验。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import type { Page } from 'playwright'
import { boardHtml, launch, startServer, waitForBoards, type FixtureProject } from './harness'

const ORIGINAL_ONE = boardHtml('方案一', '#2563eb')
const ORIGINAL_TWO = boardHtml('方案二', '#7c3aed')
const EDITED_ONE = boardHtml('方案一 · 改过', '#2563eb')
const EDITED_TWO = boardHtml('方案二 · 改过', '#7c3aed')

const PROJECT: FixtureProject = {
  id: 'e2e-versions',
  name: '版本自测',
  boards: [
    { id: 'board-001', name: '方案一', x: 0, y: 0, width: 1440, height: 900, html: ORIGINAL_ONE },
    { id: 'board-002', name: '方案二', x: 1600, y: 0, width: 1440, height: 900, html: ORIGINAL_TWO },
  ],
}

const VIEW = { width: 1280, height: 800 }

interface VersionEntry {
  id: string
  at: string
  note: string
  auto?: boolean
  boards: Record<string, { hash: string; file: string }>
}

function projectDir(root: string): string {
  return path.join(root, PROJECT.id)
}

function boardFile(root: string, boardId: string): string {
  return path.join(projectDir(root), 'artboards', boardId, 'index.html')
}

function readIndex(root: string): VersionEntry[] {
  const file = path.join(projectDir(root), 'versions', 'index.json')
  return (JSON.parse(fs.readFileSync(file, 'utf8')) as { versions: VersionEntry[] }).versions
}

function readBlob(root: string, hash: string): string {
  return fs.readFileSync(path.join(projectDir(root), 'versions', 'blobs', hash), 'utf8')
}

async function waitFor<T>(label: string, probe: () => T | null, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = probe()
    if (value !== null) return value
    if (Date.now() > deadline) throw new Error(`${timeoutMs}ms 内没有等到：${label}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

function waitForContent(file: string, needle: string): Promise<string> {
  return waitFor(`文件内容包含「${needle}」`, () => {
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
    return text.includes(needle) ? text : null
  })
}

/** 等文件逐字节变成 expected（恢复是异步写盘，不能只看子串） */
function waitForExact(file: string, expected: string): Promise<string> {
  return waitFor(`文件回到旧内容（${path.basename(path.dirname(file))}）`, () => {
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
    return text === expected ? text : null
  })
}

async function openVersions(page: Page): Promise<void> {
  await page.getByRole('button', { name: '版本' }).click()
  await page.waitForSelector('.version-panel', { timeout: 5_000 })
}

test('版本管理 E2E', async (t) => {
  const server = await startServer([PROJECT])
  const browser = await launch('chromium')
  try {
    await t.test('面板保存版本：写入索引、blob，列表出现这一版', async () => {
      const page = await browser.newPage({ viewport: VIEW })
      await page.goto(`${server.baseUrl}/p/${PROJECT.id}`)
      await waitForBoards(page, 2)
      await openVersions(page)

      await page.waitForSelector('.vp-empty')
      assert.match(await page.locator('.vp-empty').innerText(), /还没有版本/)

      await page.locator('.vp-note').fill('方案定稿')
      await page.getByRole('button', { name: '保存当前' }).click()

      await page.waitForFunction(() => document.querySelectorAll('.vp-item').length === 1, undefined, {
        timeout: 8_000,
      })
      assert.match(await page.locator('.vp-item .vp-note-text').innerText(), /方案定稿/)

      const index = readIndex(server.projectsRoot)
      assert.equal(index.length, 1, '磁盘上应该只有一个版本')
      const saved = index[0]
      assert.ok(saved, '版本索引是空的')
      assert.equal(saved.note, '方案定稿')
      assert.equal(saved.auto, undefined, '手动保存不该标成自动')
      assert.deepEqual(Object.keys(saved.boards).sort(), ['board-001', 'board-002'])
      assert.match(readBlob(server.projectsRoot, saved.boards['board-001']!.hash), /方案一/)
      await page.close()
    })

    let savedId = ''

    await t.test('改画板后整版恢复：内容回旧，画板二没被碰', async () => {
      const fileOne = boardFile(server.projectsRoot, 'board-001')
      const fileTwo = boardFile(server.projectsRoot, 'board-002')
      savedId = readIndex(server.projectsRoot)[0]!.id

      fs.writeFileSync(fileOne, EDITED_ONE)
      await waitForContent(fileOne, '改过')
      const mtimeTwoBefore = fs.statSync(fileTwo).mtimeMs
      const twoBefore = fs.readFileSync(fileTwo, 'utf8')

      const page = await browser.newPage({ viewport: VIEW })
      await page.goto(`${server.baseUrl}/p/${PROJECT.id}`)
      await waitForBoards(page, 2)
      // 改过的内容先落到画板里，恢复后要能自动换回去
      const srcBefore = await page.evaluate(
        () => (document.querySelector('.board iframe') as HTMLIFrameElement | null)?.src ?? '',
      )

      await openVersions(page)
      await page.waitForSelector('.vp-item')
      await page.locator('.vp-item').first().locator('.vp-btn').click()

      await waitForExact(fileOne, ORIGINAL_ONE)
      const restoredOne = fs.readFileSync(fileOne, 'utf8')
      assert.equal(restoredOne, ORIGINAL_ONE, '恢复后画板一应逐字节回到保存时的内容')

      // 画板二：内容和 mtime 都不该变
      assert.equal(fs.readFileSync(fileTwo, 'utf8'), twoBefore, '恢复整版不该改画板二的内容')
      assert.equal(fs.statSync(fileTwo).mtimeMs, mtimeTwoBefore, '恢复整版不该写画板二的文件')

      // 恢复前自动备份：最新一条是 auto，且存的是「改过」那一份
      const index = readIndex(server.projectsRoot)
      assert.equal(index.length, 2, '恢复后应多出一条恢复前备份')
      const backup = index[0]!
      assert.equal(backup.note, '恢复前自动备份')
      assert.equal(backup.auto, true)
      assert.match(readBlob(server.projectsRoot, backup.boards['board-001']!.hash), /改过/)
      assert.equal(index[1]!.id, savedId, '被恢复的版本应还在列表里')

      // 面板也跟着刷新：出现「自动」标签，画布上的 iframe 换新地址自动重载
      await page.waitForFunction(() => document.querySelectorAll('.vp-item').length === 2, undefined, {
        timeout: 8_000,
      })
      assert.match(await page.locator('.vp-item').first().innerText(), /自动/)
      await page.waitForFunction(
        (before) => {
          const src = (document.querySelector('.board iframe') as HTMLIFrameElement | null)?.src ?? ''
          return src !== before && src.includes('?v=')
        },
        srcBefore,
        { timeout: 8_000 },
      )
      await page.close()
    })

    await t.test('只恢复单块画板：另一块保持改动后的样子', async () => {
      const fileOne = boardFile(server.projectsRoot, 'board-001')
      const fileTwo = boardFile(server.projectsRoot, 'board-002')
      const canvasFile = path.join(projectDir(server.projectsRoot), 'layout.json')

      fs.writeFileSync(fileOne, EDITED_ONE)
      fs.writeFileSync(fileTwo, EDITED_TWO)
      await waitForContent(fileOne, '改过')
      await waitForContent(fileTwo, '改过')
      await new Promise((resolve) => setTimeout(resolve, 300))
      const canvasBefore = fs.readFileSync(canvasFile, 'utf8')

      const page = await browser.newPage({ viewport: VIEW })
      await page.goto(`${server.baseUrl}/p/${PROJECT.id}`)
      await waitForBoards(page, 2)
      await openVersions(page)

      const item = page.locator('.vp-item').filter({ hasText: '方案定稿' })
      await item.waitFor({ timeout: 8_000 })
      await item.locator('.vp-board', { hasText: 'board-002' }).click()

      await waitForExact(fileTwo, ORIGINAL_TWO)
      const two = fs.readFileSync(fileTwo, 'utf8')
      assert.equal(two, ORIGINAL_TWO, '画板二应回到保存时的内容')
      assert.match(fs.readFileSync(fileOne, 'utf8'), /改过/, '只恢复画板二时画板一的改动必须留着')
      assert.equal(fs.readFileSync(canvasFile, 'utf8'), canvasBefore, '只恢复画板不该重写 layout.json')

      const index = readIndex(server.projectsRoot)
      assert.equal(index[0]!.note, '恢复前自动备份')
      await page.close()
    })
  } finally {
    await browser.close()
    await server.stop()
  }
})
