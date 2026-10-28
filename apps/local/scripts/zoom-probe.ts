/**
 * 缩放清晰度探针（Phase 1 闸门）
 *
 * 问题：画布放大 4 倍时，iframe 里的设计稿是否按放大后的分辨率重新栅格化？
 * 三种实现各跑一遍 Chromium 与 WebKit，截图后用像素统计量化「清晰」：
 *
 *   world-zoom   世界层（iframe 的祖先元素）设 CSS zoom  ← 本应用采用
 *   iframe-zoom  iframe 元素自身设 zoom                 ← 退路一
 *   transform    祖先元素设 transform: scale()          ← 退路二
 *   blur         在 world-zoom 之上加 1px 高斯模糊        ← 校准基准，用来证明指标能分辨模糊
 *
 * 判定依据：1px 竖线在 4 倍下应变成 4 个纯黑像素、两侧一刀切；
 * 若被位图放大，边缘会拉出若干中间灰像素，峰值梯度也随之塌陷。9px 小字同理。
 *
 * 运行：pnpm probe:zoom
 *
 * 2026-10-29 结果：Chromium 156 / WebKit 27.2 下，三种实现静止时都按最终分辨率重栅格化
 * （线峰值梯度 255、无中间灰像素），blur 校准行给出 11–13 的对照，说明指标能分辨模糊。
 * 结论：世界层 CSS zoom 可用，不需要退路；清晰度风险关闭。
 */
import { createServer } from 'node:http'
import { inflateSync } from 'node:zlib'
import { chromium, webkit, type Browser } from 'playwright'

const INNER_W = 320
const INNER_H = 200
const SCALE = 4

const INNER = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: #fff; }
  .vline { position: absolute; left: 40px; top: 0; width: 1px; height: 100%; background: #000; }
  .hline { position: absolute; left: 0; top: 100px; width: 100%; height: 1px; background: #000; }
  .txt { position: absolute; left: 60px; top: 120px; font: 9px/1 -apple-system, BlinkMacSystemFont, sans-serif;
         color: #000; letter-spacing: 0; white-space: nowrap; }
</style></head>
<body>
  <div class="vline"></div>
  <div class="hline"></div>
  <div class="txt">Handgloves 0123</div>
</body></html>`

type Variant = 'world-zoom' | 'iframe-zoom' | 'transform' | 'blur'
const VARIANTS: Variant[] = ['world-zoom', 'iframe-zoom', 'transform', 'blur']

const WORLD_STYLE: Record<Variant, string> = {
  'world-zoom': `zoom: ${SCALE}`,
  'iframe-zoom': `zoom: 1`,
  transform: `transform: scale(${SCALE}); transform-origin: 0 0`,
  blur: `zoom: ${SCALE}; filter: blur(1px)`,
}

function outer(variant: Variant): string {
  const frameStyle =
    variant === 'iframe-zoom'
      ? `width:${INNER_W}px;height:${INNER_H}px;border:0;zoom:${SCALE}`
      : `width:${INNER_W}px;height:${INNER_H}px;border:0`
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; background: #fff; }
  #shot { width: ${INNER_W * SCALE}px; height: ${INNER_H * SCALE}px; overflow: hidden; background: #fff; }
  #world { width: ${INNER_W}px; height: ${INNER_H}px; ${WORLD_STYLE[variant]} }
</style></head>
<body>
  <div id="shot"><div id="world"><iframe sandbox="" src="/inner.html" style="${frameStyle}"></iframe></div></div>
</body></html>`
}

// ---------- PNG 解码（只支持 Playwright 会产出的 8 位非隔行 PNG） ----------

type Image = { width: number; height: number; lum: Float32Array }

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

function decodePng(buf: Buffer): Image {
  let off = 8
  let width = 0
  let height = 0
  let bitDepth = 8
  let colorType = 6
  let interlace = 0
  const idat: Buffer[] = []
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const start = off + 8
    if (type === 'IHDR') {
      width = buf.readUInt32BE(start)
      height = buf.readUInt32BE(start + 4)
      bitDepth = buf[start + 8] ?? 8
      colorType = buf[start + 9] ?? 6
      interlace = buf[start + 12] ?? 0
    } else if (type === 'IDAT') {
      idat.push(buf.subarray(start, start + len))
    } else if (type === 'IEND') {
      break
    }
    off = start + len + 4
  }
  if (bitDepth !== 8) throw new Error(`不支持的位深 ${bitDepth}`)
  if (interlace !== 0) throw new Error('不支持隔行 PNG')
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0
  if (ch === 0) throw new Error(`不支持的颜色类型 ${colorType}`)

  const raw = inflateSync(Buffer.concat(idat))
  if (raw.length < height * (width * ch + 1)) throw new Error('IDAT 数据不足')
  const stride = width * ch
  const out = Buffer.alloc(height * stride)
  const prev = new Uint8Array(stride)
  let rp = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++] ?? 0
    const line = raw.subarray(rp, rp + stride)
    rp += stride
    const cur = out.subarray(y * stride, (y + 1) * stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? (cur[i - ch] ?? 0) : 0
      const b = prev[i] ?? 0
      const c = i >= ch ? (prev[i - ch] ?? 0) : 0
      const x = line[i] ?? 0
      const pred =
        filter === 0 ? 0
        : filter === 1 ? a
        : filter === 2 ? b
        : filter === 3 ? (a + b) >> 1
        : filter === 4 ? paeth(a, b, c)
        : -1
      if (pred < 0) throw new Error(`未知过滤类型 ${filter}`)
      cur[i] = (x + pred) & 0xff
    }
    prev.set(cur)
  }

  const lum = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * stride + x * ch
      const r = out[i] ?? 255
      const g = ch >= 3 ? (out[i + 1] ?? 255) : r
      const b2 = ch >= 3 ? (out[i + 2] ?? 255) : r
      lum[y * width + x] = 0.2126 * r + 0.7152 * g + 0.0722 * b2
    }
  }
  return { width, height, lum }
}

// ---------- 指标 ----------

type Metrics = {
  /** 4 倍下 1px 竖线所在扫描行的最大相邻梯度（0–255），越接近 255 越锐 */
  linePeakGradient: number
  /** 同一扫描行里落在中间灰（64–191）的像素数，模糊会变多 */
  lineMidPixels: number
  /** 文本区域内接近纯黑的像素占比 % */
  textDarkPct: number
  /** 文本区域内中间灰占比 %，模糊会变多 */
  textMidPct: number
}

function at(img: Image, x: number, y: number): number {
  return img.lum[y * img.width + x] ?? 255
}

function metrics(img: Image): Metrics {
  // 竖线：内页 x=40，4 倍后落在 160 附近。取一条不碰到横线（内页 y=100 → 400）的扫描行。
  const row = Math.min(img.height - 1, Math.round(60 * SCALE / 2))
  let peak = 0
  let mid = 0
  for (let x = 1; x < img.width; x++) {
    const d = Math.abs(at(img, x, row) - at(img, x - 1, row))
    if (d > peak) peak = d
  }
  for (let x = 0; x < img.width; x++) {
    const v = at(img, x, row)
    if (v >= 64 && v <= 191) mid++
  }

  // 文本：内页 left 60 / top 120、字号 9px，4 倍后大致落在 x 240–1100、y 480–516
  const x0 = 55 * SCALE
  const x1 = Math.min(img.width, 280 * SCALE)
  const y0 = 118 * SCALE
  const y1 = Math.min(img.height, 132 * SCALE)
  let dark = 0
  let grey = 0
  let total = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = at(img, x, y)
      if (v < 64) dark++
      else if (v <= 191) grey++
      total++
    }
  }
  return {
    linePeakGradient: Math.round(peak),
    lineMidPixels: mid,
    textDarkPct: total ? +(dark / total * 100).toFixed(2) : 0,
    textMidPct: total ? +(grey / total * 100).toFixed(2) : 0,
  }
}

// ---------- 主流程 ----------

async function probe(browser: Browser, name: string, base: string) {
  const rows: { 引擎: string; 实现: string; 线峰值梯度: number; 线中间灰: number; 文本深墨: number; 文本中间灰: number }[] = []
  const ctx = await browser.newContext({ viewport: { width: INNER_W * SCALE + 40, height: INNER_H * SCALE + 40 }, deviceScaleFactor: 1 })
  try {
    for (const variant of VARIANTS) {
      const page = await ctx.newPage()
      await page.goto(`${base}/?v=${variant}`)
      await page.waitForLoadState('load')
      await page.waitForTimeout(400)
      const shot = await page.locator('#shot').screenshot()
      const img = decodePng(shot)
      const m = metrics(img)
      rows.push({
        引擎: name,
        实现: variant,
        线峰值梯度: m.linePeakGradient,
        线中间灰: m.lineMidPixels,
        文本深墨: m.textDarkPct,
        文本中间灰: m.textMidPct,
      })
      await page.close()
    }
  } finally {
    await ctx.close()
  }
  return rows
}

function printTable(rows: ReturnType<typeof probe> extends Promise<infer R> ? R : never) {
  const headers = ['引擎', '实现', '线峰值梯度', '线中间灰', '文本深墨%', '文本中间灰%', '判定'] as const
  const cells = rows.map((r) => {
    const ok = r.线峰值梯度 >= 200 && r.线中间灰 <= 4 && r.文本中间灰 <= r.文本深墨
    return [
      r.引擎,
      r.实现,
      String(r.线峰值梯度),
      String(r.线中间灰),
      r.文本深墨.toFixed(2),
      r.文本中间灰.toFixed(2),
      r.实现 === 'blur' ? '（校准：应判模糊）' : ok ? '清晰' : '模糊',
    ]
  })
  const all = [headers as unknown as string[], ...cells]
  const widths = headers.map((_, i) => Math.max(...all.map((row) => displayWidth(row[i] ?? ''))))
  for (const row of all) {
    console.log(row.map((cell, i) => pad(cell, widths[i] ?? 0)).join('  '))
  }
}

function displayWidth(s: string): number {
  let w = 0
  for (const ch of s) w += /[^\x00-\xff]/.test(ch) ? 2 : 1
  return w
}

function pad(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - displayWidth(s)))
}

async function main() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/inner.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(INNER)
      return
    }
    const variant = url.searchParams.get('v') as Variant | null
    if (!variant || !VARIANTS.includes(variant)) {
      res.writeHead(404).end('unknown variant')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(outer(variant))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('监听失败')
  const base = `http://127.0.0.1:${addr.port}`
  console.log(`探针页面：${base}  （每块画板 ${INNER_W}×${INNER_H}，放大 ${SCALE} 倍）\n`)

  const results = []
  for (const [name, launcher] of [['chromium', chromium], ['webkit', webkit]] as const) {
    const browser = await launcher.launch()
    try {
      results.push(...(await probe(browser, name, base)))
    } finally {
      await browser.close()
    }
  }
  printTable(results as never)

  const verdict = results.filter((r) => r.实现 === 'world-zoom')
  console.log('\n结论：')
  for (const r of verdict) {
    const sharp = r.线峰值梯度 >= 200 && r.线中间灰 <= 4
    console.log(`  ${r.引擎} 世界层 zoom：${sharp ? '按放大后分辨率重栅格化，文字与 1px 线清晰' : '被位图放大，需要启用退路'}`)
  }

  server.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
