/**
 * 画板里的本地资源：图片、字体、共享样式表能不能真的加载。
 *
 * 画板是 sandbox=""（不透明源），CSP 只放行本机地址，所以这里有三个容易回归的点：
 * 1. assets/ 下的图片能在 iframe 里画出像素（不是 0×0 的破图）；
 * 2. assets/ 下的字体文件带 ACAO: *（不透明源的字体请求必须走 CORS）；
 * 3. design-system/ 下的样式表能被画板引用并生效。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { launch, startServer, waitForBoards, type FixtureProject } from './harness'

/** 1×1 透明 PNG */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  'base64',
)

const BOARD_HTML = `<!doctype html>
<html lang="zh-Hans"><head><meta charset="utf-8"><title>资源自测</title>
<link rel="stylesheet" href="../../design-system/rules.css">
<style>
  @font-face { font-family: 'DemoFont'; src: url('../../assets/fonts/demo.woff2') format('woff2'); }
  body { margin: 0; height: 100vh; display: grid; place-items: center; gap: 12px;
         font: 13px/1.6 -apple-system, "PingFang SC", sans-serif; }
  .demo { font-family: 'DemoFont', sans-serif; }
</style></head>
<body>
  <img id="dot" src="../../assets/images/dot.png" alt="">
  <div class="demo accent" id="fonted">资源</div>
</body></html>
`

const PROJECT: FixtureProject = {
  id: 'e2e-assets',
  name: '资源自测',
  boards: [{ id: 'board-001', name: '资源', x: 0, y: 0, width: 800, height: 600, html: BOARD_HTML }],
}

const VIEW = { width: 1280, height: 800 }

function projectDir(root: string): string {
  return path.join(root, PROJECT.id)
}

/** harness 只写画板骨架，资源文件在这里补上 */
function writeAssets(root: string): void {
  const images = path.join(projectDir(root), 'assets', 'images')
  const fonts = path.join(projectDir(root), 'assets', 'fonts')
  fs.mkdirSync(images, { recursive: true })
  fs.mkdirSync(fonts, { recursive: true })
  fs.writeFileSync(path.join(images, 'dot.png'), PNG_1PX)
  // 不是真的 woff2：这里验的是「能不能取到、CSP 放不放行、有没有 CORS 头」
  fs.writeFileSync(path.join(fonts, 'demo.woff2'), Buffer.from('wOF2 fake font payload'))
  fs.writeFileSync(path.join(projectDir(root), 'design-system', 'rules.css'), '.accent { color: rgb(12, 34, 56); }\n')
}

function headersOf(file: string): Promise<{ status: number; contentType: string; acao: string }> {
  return fetch(file).then((res) => ({
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    acao: res.headers.get('access-control-allow-origin') ?? '',
  }))
}

test('画板资源 E2E', async (t) => {
  const server = await startServer([PROJECT])
  writeAssets(server.projectsRoot)
  const browser = await launch('chromium')
  try {
    await t.test('图片、字体、共享样式表都能取到，并且带头给不透明源用', async () => {
      const base = `${server.baseUrl}/files/${PROJECT.id}`

      const image = await headersOf(`${base}/assets/images/dot.png`)
      assert.equal(image.status, 200)
      assert.equal(image.contentType, 'image/png')
      assert.equal(image.acao, '*', '不透明源取图片必须带 ACAO')

      const font = await headersOf(`${base}/assets/fonts/demo.woff2`)
      assert.equal(font.status, 200)
      assert.equal(font.contentType, 'font/woff2')
      assert.equal(font.acao, '*', '字体请求是 CORS 请求，没有 ACAO 会被拦')

      const css = await headersOf(`${base}/design-system/rules.css`)
      assert.equal(css.status, 200)
      assert.equal(css.contentType, 'text/css; charset=utf-8')
    })

    await t.test('画板里图片真的画出来，共享样式表的规则生效', async () => {
      const page = await browser.newPage({ viewport: VIEW })
      const responses: Array<{ url: string; status: number }> = []
      page.on('response', (res) => responses.push({ url: res.url(), status: res.status() }))

      await page.goto(`${server.baseUrl}/p/${PROJECT.id}`)
      await waitForBoards(page, 1)

      const frame = page.frames().find((f) => f.url().includes(`/files/${PROJECT.id}/`))
      assert.ok(frame, '找不到画板 iframe')

      await frame.waitForFunction(() => {
        const img = document.getElementById('dot') as HTMLImageElement | null
        return !!img && img.complete && img.naturalWidth > 0
      }, undefined, { timeout: 8_000 })

      const image = await frame.evaluate(() => {
        const img = document.getElementById('dot') as HTMLImageElement
        return { width: img.naturalWidth, height: img.naturalHeight }
      })
      assert.equal(image.width, 1, '图片没加载出来（naturalWidth 为 0）')
      assert.equal(image.height, 1)

      // 共享样式表里的规则作用到了画板里
      await frame.waitForFunction(
        () => getComputedStyle(document.getElementById('fonted') as HTMLElement).color === 'rgb(12, 34, 56)',
        undefined,
        { timeout: 8_000 },
      )

      // 字体文件确实被画板拉了一次（加载成败看字体本身，这里只验请求没有被 CSP 拦掉）
      const fontRequest = responses.find((r) => r.url.includes('/assets/fonts/demo.woff2'))
      assert.ok(fontRequest, '画板没有去取字体文件，可能被 CSP 挡了')
      assert.equal(fontRequest.status, 200, '字体文件请求没成功')
      await page.close()
    })
  } finally {
    await browser.close()
    await server.stop()
  }
})
