/**
 * 画布交互：首次取景、指针锚定缩放、平移、聚焦层、深链、适应窗口、文件改动自动刷新。
 * Chromium 全量跑；WebKit 只跑取景与指针锚定的两条关键路径。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import type { Page } from 'playwright'
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
  id: 'e2e-canvas',
  name: '画布自测',
  boards: [
    { id: 'board-001', name: '方案一', x: 0, y: 0, width: 1440, height: 900, html: boardHtml('方案一', '#2563eb') },
    { id: 'board-002', name: '方案二', x: 1600, y: 0, width: 1440, height: 900, html: boardHtml('方案二', '#7c3aed') },
  ],
}

const VIEW = { width: 1280, height: 800 }
const PAD = 80
/** 两块画板的世界包围盒 */
const BOUNDS = { width: 3040, height: 900 }
const FIT_SCALE = Math.min(1, (VIEW.width - PAD * 2) / BOUNDS.width, (VIEW.height - PAD * 2) / BOUNDS.height)

/** 用真实事件驱动缩放：ctrlKey + 小数 deltaY = 触控板捏合 */
async function pinch(page: Page, x: number, y: number, deltaY: number): Promise<void> {
  await page.evaluate(
    ({ x, y, deltaY }) => {
      const host = document.querySelector('.canvas-host') as HTMLElement
      host.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY,
          clientX: x,
          clientY: y,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      )
    },
    { x, y, deltaY },
  )
  await page.waitForTimeout(80)
}

/** 指针下的世界坐标：屏幕点扣除位移、除以缩放 */
function worldPoint(view: { x: number; y: number; scale: number }, px: number, py: number) {
  return { wx: (px - view.x) / view.scale, wy: (py - view.y) / view.scale }
}

test('画布 E2E', async (t) => {
  const server = await startServer([PROJECT])
  const browser = await launch('chromium')
  try {
    await t.test('初次打开把全部画板放进视野', async () => {
      const page = await browser.newPage({ viewport: VIEW })
      await page.goto(`${server.baseUrl}/p/e2e-canvas`)
      await waitForBoards(page, 2)

      const view = await readView(page)
      assert.ok(Math.abs(view.scale - FIT_SCALE) < 0.01, `缩放应约等于 ${FIT_SCALE}，实际 ${view.scale}`)

      const rects = await boardRects(page)
      const left = Math.min(...rects.map((r) => r.left))
      const right = Math.max(...rects.map((r) => r.left + r.width))
      const top = Math.min(...rects.map((r) => r.top))
      const bottom = Math.max(...rects.map((r) => r.top + r.height))
      assert.ok(left >= PAD - 1 && right <= VIEW.width - PAD + 1, `横向没落进留白：${left} → ${right}`)
      assert.ok(top >= PAD - 1 && bottom <= VIEW.height - PAD + 1, `纵向没落进留白：${top} → ${bottom}`)
      await page.close()
    })

    await t.test('缩放以指针为中心，指针下方的世界坐标不动', async () => {
      const page = await browser.newPage({ viewport: VIEW })
      await page.goto(`${server.baseUrl}/p/e2e-canvas`)
      await waitForBoards(page, 2)

      const before = await readView(page)
      const px = 420
      const py = 380
      const point = worldPoint(before, px, py)
      await pinch(page, px, py, -12.5)
      const after = await readView(page)

      assert.ok(after.scale > before.scale * 1.05, `缩放应当变大：${before.scale} → ${after.scale}`)
      const moved = worldPoint(after, px, py)
      assert.ok(
        Math.abs(moved.wx - point.wx) < 0.5 && Math.abs(moved.wy - point.wy) < 0.5,
        `锚点漂了：${JSON.stringify(point)} → ${JSON.stringify(moved)}`,
      )
      await page.close()
    })

    await t.test('拖拽空白处平移，位移与鼠标位移一致', async () => {
      const page = await browser.newPage({ viewport: VIEW })
      await page.goto(`${server.baseUrl}/p/e2e-canvas`)
      await waitForBoards(page, 2)

      const before = await readView(page)
      await page.mouse.move(1150, 720)
      await page.mouse.down()
      await page.mouse.move(1210, 760, { steps: 6 })
      await page.mouse.up()
      const after = await readView(page)

      assert.ok(Math.abs(after.x - before.x - 60) < 1.5, `横向平移应为 60，实际 ${after.x - before.x}`)
      assert.ok(Math.abs(after.y - before.y - 40) < 1.5, `纵向平移应为 40，实际 ${after.y - before.y}`)
      assert.equal(after.scale, before.scale)
      await page.close()
    })

    await t.test('双击画板打开聚焦层，Esc 退出', async () => {
      const page = await browser.newPage({ viewport: VIEW })
      await page.goto(`${server.baseUrl}/p/e2e-canvas`)
      await waitForBoards(page, 2)

      const target = (await boardRects(page)).find((r) => r.id === 'board-002')
      assert.ok(target, '找不到 board-002')
      await page.mouse.dblclick(target.left + target.width / 2, target.top + target.height / 2)
      await page.waitForSelector('.focus-layer', { timeout: 5000 })
      const head = await page.textContent('.focus-head')
      assert.ok(head?.includes('board-002'), `聚焦层标题不对：${head}`)

      await page.keyboard.press('Escape')
      await page.waitForSelector('.focus-layer', { state: 'detached', timeout: 5000 })
      await page.close()
    })

    await t.test('「尺寸」开关：打开后悬停画框显示 Figma 式标签', async () => {
      const page = await browser.newPage({ viewport: VIEW })
      await page.goto(`${server.baseUrl}/p/e2e-canvas`)
      await waitForBoards(page, 2)

      const target = (await boardRects(page)).find((r) => r.id === 'board-002')
      assert.ok(target, '找不到 board-002')
      const cx = target.left + target.width / 2
      const cy = target.top + target.height / 2

      // 默认关：悬停不出现
      await page.mouse.move(cx, cy)
      await page.waitForTimeout(120)
      assert.equal(await page.locator('.board-spec').count(), 0, '关闭时不该有尺寸标签')

      // 打开开关，再移入画框
      await page.click('.canvas-tools button:has-text("尺寸")')
      await page.mouse.move(10, 10)
      await page.mouse.move(cx, cy)
      await page.waitForSelector('.board-spec', { timeout: 3000 })
      const label = await page.textContent('.board-spec')
      assert.ok(label?.includes('方案二'), `标签应带画板名：${label}`)
      assert.ok(label?.includes('1440 × 900'), `标签应带设计尺寸：${label}`)

      // 关掉后不再出现
      await page.mouse.move(10, 10)
      await page.click('.canvas-tools button:has-text("尺寸")')
      await page.mouse.move(cx, cy)
      await page.waitForTimeout(120)
      assert.equal(await page.locator('.board-spec').count(), 0, '关闭后不该再有尺寸标签')
      await page.close()
    })

    await t.test('聚焦层进全屏：只剩查看器横栏，Esc 先退回聚焦层再关掉', async () => {
      const page = await browser.newPage({ viewport: VIEW })
      await page.goto(`${server.baseUrl}/p/e2e-canvas`)
      await waitForBoards(page, 2)

      const target = (await boardRects(page)).find((r) => r.id === 'board-002')
      assert.ok(target, '找不到 board-002')
      await page.mouse.dblclick(target.left + target.width / 2, target.top + target.height / 2)
      await page.waitForSelector('.focus-head', { timeout: 5000 })

      await page.click('.focus-expand')
      await page.waitForSelector('.viewer-bar', { timeout: 5000 })

      const bar = await page.textContent('.viewer-bar')
      assert.ok(bar?.includes('board-002') && bar.includes('方案二'), `查看器横栏不对：${bar}`)
      assert.equal(await page.locator('.focus-head').count(), 0, '全屏时不该还有聚焦层标题')

      // 全屏盖住整个视口，底下的画布工具条和项目标记要藏起来
      for (const sel of ['.canvas-tools', '.project-head']) {
        const visible = await page.locator(sel).isVisible()
        assert.equal(visible, false, `${sel} 在全屏下面不该露出来`)
      }

      await page.keyboard.press('Escape')
      await page.waitForSelector('.viewer-bar', { state: 'detached', timeout: 5000 })
      await page.waitForSelector('.focus-head', { timeout: 5000 })
      assert.equal(await page.locator('.focus-layer').count(), 1, 'Esc 一次只退回聚焦层')

      await page.keyboard.press('Escape')
      await page.waitForSelector('.focus-layer', { state: 'detached', timeout: 5000 })
      await page.close()
    })

    await t.test('深链 ?focus=&scale= 直接落在某块画板上', async () => {
      const page = await browser.newPage({ viewport: VIEW })
      await page.goto(`${server.baseUrl}/p/e2e-canvas?focus=board-002&scale=0.5`)
      await waitForBoards(page, 2)

      const view = await readView(page)
      assert.ok(Math.abs(view.scale - 0.5) < 0.005, `缩放应为 0.5，实际 ${view.scale}`)
      const target = (await boardRects(page)).find((r) => r.id === 'board-002')
      assert.ok(target, '找不到 board-002')
      assert.ok(Math.abs(target.width - 720) < 2, `画板宽度应为 720，实际 ${target.width}`)
      assert.ok(
        Math.abs(target.left + target.width / 2 - VIEW.width / 2) < 2,
        `画板没有水平居中：中心在 ${target.left + target.width / 2}`,
      )
      assert.ok(
        Math.abs(target.top + target.height / 2 - VIEW.height / 2) < 2,
        `画板没有垂直居中：中心在 ${target.top + target.height / 2}`,
      )
      await page.close()
    })

    await t.test('深链里的画板不存在时退回全部取景', async () => {
      const page = await browser.newPage({ viewport: VIEW })
      await page.goto(`${server.baseUrl}/p/e2e-canvas?focus=board-404`)
      await waitForBoards(page, 2)
      const view = await readView(page)
      assert.ok(Math.abs(view.scale - FIT_SCALE) < 0.01, `应取景全部画板，实际缩放 ${view.scale}`)
      await page.close()
    })

    await t.test('「适应窗口」把全部画板放回视野', async () => {
      const page = await browser.newPage({ viewport: VIEW })
      await page.goto(`${server.baseUrl}/p/e2e-canvas?focus=board-002&scale=2`)
      await waitForBoards(page, 2)

      await page.click('.canvas-tools button:has-text("适应窗口")')
      await page.waitForTimeout(120)
      const rects = await boardRects(page)
      for (const rect of rects) {
        assert.ok(rect.left >= 0 && rect.left + rect.width <= VIEW.width, `${rect.id} 横向还在视野外`)
        assert.ok(rect.top >= 0 && rect.top + rect.height <= VIEW.height, `${rect.id} 纵向还在视野外`)
      }
      await page.close()
    })

    await t.test('画板文件改动后只换这一块的 ?v=，页面不刷新', async () => {
      const page = await browser.newPage({ viewport: VIEW })
      await page.goto(`${server.baseUrl}/p/e2e-canvas`)
      await waitForBoards(page, 2)
      await page.waitForTimeout(400)

      const srcOf = (index: number) =>
        page.evaluate((i) => (document.querySelectorAll('iframe')[i] as HTMLIFrameElement | undefined)?.src ?? '', index)
      const [before1, before2] = [await srcOf(0), await srcOf(1)]
      assert.ok(before1 && before2)

      const file = path.join(server.projectsRoot, 'e2e-canvas', 'artboards', 'board-001', 'index.html')
      fs.writeFileSync(file, boardHtml('方案一（改过）', '#2563eb'))

      await page.waitForFunction(
        (src) => (document.querySelectorAll('iframe')[0] as HTMLIFrameElement | undefined)?.src !== src,
        before1,
        { timeout: 10_000 },
      )
      const after1 = await srcOf(0)
      const after2 = await srcOf(1)
      assert.notEqual(after1, before1, 'board-001 没有换 ?v=')
      assert.equal(after2, before2, 'board-002 不该被重载')
      await page.close()
    })
  } finally {
    await browser.close()
    await server.stop()
  }
})

test('WebKit：取景与指针锚定', async (t) => {
  const server = await startServer([PROJECT])
  const browser = await launch('webkit')
  try {
    await t.test('取景', async () => {
      const page = await browser.newPage({ viewport: VIEW })
      await page.goto(`${server.baseUrl}/p/e2e-canvas`)
      await waitForBoards(page, 2)
      const view = await readView(page)
      assert.ok(Math.abs(view.scale - FIT_SCALE) < 0.01, `WebKit 缩放 ${view.scale}`)
      await page.close()
    })

    await t.test('指针锚定缩放', async () => {
      const page = await browser.newPage({ viewport: VIEW })
      await page.goto(`${server.baseUrl}/p/e2e-canvas`)
      await waitForBoards(page, 2)
      const before = await readView(page)
      await pinch(page, 500, 400, -12.5)
      const after = await readView(page)
      const p1 = worldPoint(before, 500, 400)
      const p2 = worldPoint(after, 500, 400)
      assert.ok(after.scale > before.scale, `WebKit 没放大：${before.scale} → ${after.scale}`)
      assert.ok(Math.abs(p1.wx - p2.wx) < 0.5 && Math.abs(p1.wy - p2.wy) < 1.5, 'WebKit 锚点漂移超限')
      await page.close()
    })
  } finally {
    await browser.close()
    await server.stop()
  }
})
