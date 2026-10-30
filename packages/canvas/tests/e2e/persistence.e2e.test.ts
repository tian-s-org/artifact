/**
 * 布局持久化：拖动画板 → 写回 layout.json → 刷新后从磁盘恢复。
 * 同时盯住「拖画板不动视口」这条容易回归的行为。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  boardHtml,
  boardRects,
  launch,
  readView,
  startServer,
  waitForBoards,
  type FixtureProject,
} from './harness'

const PROJECT: FixtureProject = {
  id: 'e2e-persist',
  name: '持久化自测',
  boards: [
    { id: 'board-001', name: '方案一', x: 0, y: 0, width: 1440, height: 900, html: boardHtml('方案一', '#2563eb') },
    { id: 'board-002', name: '方案二', x: 1600, y: 0, width: 1440, height: 900, html: boardHtml('方案二', '#7c3aed') },
  ],
}

const VIEW = { width: 1280, height: 800 }

interface CanvasJson {
  boards: Array<{ id: string; x: number; y: number }>
}

function readCanvas(projectsRoot: string): CanvasJson {
  const file = path.join(projectsRoot, PROJECT.id, 'layout.json')
  return JSON.parse(fs.readFileSync(file, 'utf8')) as CanvasJson
}

async function waitForDisk(
  projectsRoot: string,
  boardId: string,
  predicate: (board: { x: number; y: number }) => boolean,
): Promise<{ x: number; y: number }> {
  const deadline = Date.now() + 8000
  for (;;) {
    const board = readCanvas(projectsRoot).boards.find((b) => b.id === boardId)
    if (board && predicate(board)) return board
    if (Date.now() > deadline) throw new Error(`layout.json 没有在 8 秒内更新：${JSON.stringify(board)}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

test('布局持久化 E2E', async (t) => {
  const server = await startServer([PROJECT])
  const browser = await launch('chromium')
  try {
    await t.test('拖动画板写回 layout.json，刷新后位置还在', async () => {
      const page = await browser.newPage({ viewport: VIEW })
      await page.goto(`${server.baseUrl}/p/${PROJECT.id}`)
      await waitForBoards(page, 2)

      const viewBefore = await readView(page)
      const target = (await boardRects(page)).find((r) => r.id === 'board-001')
      assert.ok(target, '找不到 board-001')

      const dx = 120
      const dy = 80
      await page.mouse.move(target.left + target.width / 2, target.top + target.height / 2)
      await page.mouse.down()
      await page.mouse.move(target.left + target.width / 2 + dx, target.top + target.height / 2 + dy, { steps: 8 })
      await page.mouse.up()

      const expectedX = Math.round(dx / viewBefore.scale)
      const expectedY = Math.round(dy / viewBefore.scale)
      const saved = await waitForDisk(server.projectsRoot, 'board-001', (board) => board.x !== 0 || board.y !== 0)
      assert.ok(Math.abs(saved.x - expectedX) <= 3, `写回的 x 应约 ${expectedX}，实际 ${saved.x}`)
      assert.ok(Math.abs(saved.y - expectedY) <= 3, `写回的 y 应约 ${expectedY}，实际 ${saved.y}`)

      // 视口没被拖画板带跑
      const viewAfter = await readView(page)
      assert.ok(
        Math.abs(viewAfter.x - viewBefore.x) < 1 && Math.abs(viewAfter.y - viewBefore.y) < 1,
        `拖画板不该移动视口：${JSON.stringify(viewBefore)} → ${JSON.stringify(viewAfter)}`,
      )

      await page.reload()
      await waitForBoards(page, 2)
      const positions = await page.evaluate(() =>
        [...document.querySelectorAll('.board')].map((el) => ({
          id: (el.querySelector('.board-id')?.textContent ?? '').trim(),
          x: parseFloat((el as HTMLElement).style.left),
          y: parseFloat((el as HTMLElement).style.top),
        })),
      )
      const moved = positions.find((p) => p.id === 'board-001')
      assert.ok(moved, '刷新后找不到 board-001')
      assert.equal(moved.x, saved.x, '刷新后 x 应从 layout.json 恢复')
      assert.equal(moved.y, saved.y, '刷新后 y 应从 layout.json 恢复')
      await page.close()
    })

    await t.test('轻点画板不写盘', async () => {
      const before = readCanvas(server.projectsRoot).boards.find((b) => b.id === 'board-002')
      const page = await browser.newPage({ viewport: VIEW })
      await page.goto(`${server.baseUrl}/p/${PROJECT.id}`)
      await waitForBoards(page, 2)

      const target = (await boardRects(page)).find((r) => r.id === 'board-002')
      assert.ok(target)
      await page.mouse.click(target.left + target.width / 2, target.top + target.height / 2)
      await page.waitForTimeout(600)
      const after = readCanvas(server.projectsRoot).boards.find((b) => b.id === 'board-002')
      assert.deepEqual(after, before, '单击不该移动画板')
      await page.close()
    })
  } finally {
    await browser.close()
    await server.stop()
  }
})
