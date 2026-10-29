/**
 * 隔离与安全：画板之间同名 class 互不影响、画板脚本不执行、外网请求发不出去、
 * 父页面读不到画板内部，画布元数据不对外。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { averageColor, decodePng, near } from './png'
import { boardRects, launch, startServer, waitForBoards, type FixtureProject } from './harness'

const BLUE = '#2563eb'
const PURPLE = '#7c3aed'

/** 两块画板用逐字相同的 CSS，只有 :root 里的变量值不同 */
function solidBoard(label: string, accent: string): string {
  return `<!doctype html>
<html lang="zh-Hans"><head><meta charset="utf-8"><title>${label}</title>
<style>
  :root { --accent: ${accent}; }
  html, body { margin: 0; height: 100%; background: var(--accent); }
  .accent { display: none; }
</style></head>
<body><div class="accent">${label}</div></body></html>
`
}

const HOSTILE = `<!doctype html>
<html lang="zh-Hans"><head><meta charset="utf-8"><title>不老实</title></head>
<body style="margin:0;background:#fff;font:14px sans-serif">
  <p>这块画板想干坏事</p>
  <script>parent.__pwned = true; top.__pwned = true;</script>
  <img src="https://example.invalid/tracker.png" alt="">
  <iframe src="https://example.invalid/frame.html"></iframe>
</body></html>
`

const PROJECT: FixtureProject = {
  id: 'e2e-isolation',
  name: '隔离自测',
  boards: [
    { id: 'board-001', name: '蓝', x: 0, y: 0, width: 800, height: 600, html: solidBoard('蓝', BLUE) },
    { id: 'board-002', name: '紫', x: 900, y: 0, width: 800, height: 600, html: solidBoard('紫', PURPLE) },
    { id: 'board-003', name: '不老实', x: 0, y: 700, width: 800, height: 600, html: HOSTILE },
  ],
}

const VIEW = { width: 1280, height: 800 }

test('隔离与安全 E2E', async (t) => {
  const server = await startServer([PROJECT])
  const browser = await launch('chromium')
  try {
    await t.test('同名 class 的两块画板各是各的颜色', async () => {
      const page = await browser.newPage({ viewport: VIEW })
      await page.goto(`${server.baseUrl}/p/${PROJECT.id}`)
      await waitForBoards(page, 3)
      await page.waitForTimeout(300)

      const rects = await boardRects(page)
      const sample = async (id: string) => {
        const rect = rects.find((r) => r.id === id)
        assert.ok(rect, `找不到 ${id}`)
        const png = await page.screenshot({
          clip: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        })
        return averageColor(decodePng(png))
      }

      const blue = await sample('board-001')
      const purple = await sample('board-002')
      assert.ok(near(blue.b, 235, 12) && near(blue.r, 37, 14), `board-001 应是蓝色，实测 ${JSON.stringify(blue)}`)
      assert.ok(near(purple.r, 124, 14) && near(purple.b, 237, 12), `board-002 应是紫色，实测 ${JSON.stringify(purple)}`)
      await page.close()
    })

    await t.test('画板里的脚本不执行，父页面不被污染', async () => {
      const page = await browser.newPage({ viewport: VIEW })
      await page.goto(`${server.baseUrl}/p/${PROJECT.id}`)
      await waitForBoards(page, 3)
      await page.waitForTimeout(600)

      const pwned = await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)
      assert.equal(pwned, undefined, '画板脚本竟然跑起来了')

      const sandbox = await page.getAttribute('iframe[title="不老实"]', 'sandbox')
      assert.equal(sandbox, '', '画板 iframe 必须是 sandbox=""（不透明源、不许脚本）')
      await page.close()
    })

    await t.test('画板里的外网请求发不出去', async () => {
      const page = await browser.newPage({ viewport: VIEW })
      const external: Array<{ url: string; outcome: string }> = []
      const violations: string[] = []
      page.on('console', (msg) => {
        if (/violates the following Content Security Policy/.test(msg.text())) violations.push(msg.text())
      })
      page.on('requestfinished', (req) => {
        if (req.url().startsWith('https://example.invalid')) external.push({ url: req.url(), outcome: 'finished' })
      })
      page.on('requestfailed', (req) => {
        if (req.url().startsWith('https://example.invalid')) {
          external.push({ url: req.url(), outcome: req.failure()?.errorText ?? 'failed' })
        }
      })
      await page.goto(`${server.baseUrl}/p/${PROJECT.id}`)
      await waitForBoards(page, 3)
      await page.waitForTimeout(800)

      // CSP 拦下的请求仍然会以「发起过、被 csp 挡掉」的形式出现在 DevTools 里，
      // 关键是它没有真的发出去：既没有 finished，失败原因也得是 csp。
      const leaked = external.filter((item) => item.outcome !== 'csp')
      assert.deepEqual(leaked, [], `画板有外网请求真的发出去了：${JSON.stringify(leaked)}`)
      assert.ok(
        external.some((item) => item.url === 'https://example.invalid/tracker.png'),
        `外链图片没有被处理：${JSON.stringify(external)}`,
      )
      // 内嵌外站 iframe 由 default-src 'none' 挡掉，浏览器不为它发请求事件，只报 CSP 违规
      assert.ok(
        violations.some((text) => text.includes('example.invalid')),
        `外站 iframe 没有被拦：${violations.join(' | ') || '(没有 CSP 违规日志)'}`,
      )

      const csp = await page.evaluate(async () => {
        const res = await fetch('/files/e2e-isolation/artboards/board-003/index.html')
        return res.headers.get('content-security-policy') ?? ''
      })
      assert.ok(csp.includes("default-src 'none'"), `画板没有带 CSP：${csp}`)
      assert.ok(csp.includes("img-src http://127.0.0.1:*"), `CSP 里的 img-src 不对：${csp}`)
      await page.close()
    })

    await t.test('父页面读不到画板内部（不透明源）', async () => {
      const page = await browser.newPage({ viewport: VIEW })
      await page.goto(`${server.baseUrl}/p/${PROJECT.id}`)
      await waitForBoards(page, 3)

      const errorName = await page.evaluate(() => {
        const frame = document.querySelector('iframe') as HTMLIFrameElement | null
        if (!frame?.contentWindow) return 'no-frame'
        try {
          void frame.contentWindow.document.body
          return 'readable'
        } catch (err) {
          return (err as Error).name
        }
      })
      assert.equal(errorName, 'SecurityError', `画板内部竟然可读：${errorName}`)
      await page.close()
    })

    await t.test('画布元数据与版本目录一律 403', async () => {
      const page = await browser.newPage({ viewport: VIEW })
      await page.goto(`${server.baseUrl}/p/${PROJECT.id}`)
      const statuses = await page.evaluate(async () => {
        const targets = [
          '/files/e2e-isolation/canvas.json',
          '/files/e2e-isolation/context.md',
          '/files/e2e-isolation/versions/index.json',
          '/files/e2e-isolation/artboards/board-001/index.html',
        ]
        const out: Record<string, number> = {}
        for (const target of targets) out[target] = (await fetch(target)).status
        return out
      })
      assert.equal(statuses['/files/e2e-isolation/canvas.json'], 403)
      assert.equal(statuses['/files/e2e-isolation/context.md'], 403)
      assert.equal(statuses['/files/e2e-isolation/versions/index.json'], 403)
      assert.equal(statuses['/files/e2e-isolation/artboards/board-001/index.html'], 200)
      await page.close()
    })
  } finally {
    await browser.close()
    await server.stop()
  }
})
