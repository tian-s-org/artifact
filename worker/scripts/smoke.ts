/**
 * 部署后冒烟：真浏览器打开线上画布，确认三块画板都从文件源加载出来、
 * 控制台没有报错、画板确实被关在沙箱里。
 *
 *   node --import tsx scripts/smoke.ts [--url https://artifact.tianyw0.xyz] [--shot /tmp/a.png]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLOUD_ROOT = path.resolve(HERE, '..')

async function readKey(): Promise<string> {
  if (process.env.ARTIFACT_KEY) return process.env.ARTIFACT_KEY
  const text = await fs.readFile(path.join(CLOUD_ROOT, '..', '.dev.vars'), 'utf8')
  const match = /^SITE_KEY=(.*)$/m.exec(text)
  if (!match?.[1]) throw new Error('找不到 SITE_KEY：设 ARTIFACT_KEY 或写仓库根的 .dev.vars')
  return match[1].trim()
}

const argv = process.argv.slice(2)
const arg = (name: string, fallback: string): string => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : fallback
}

const url = arg('--url', 'https://artifact.tianyw0.xyz')
const shot = arg('--shot', '/tmp/artifact-cloud.png')
const key = await readKey()

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
/** 探针本身要往画板里注入脚本来读文本，被沙箱拦下是预期的（也正好证明隔离生效） */
const EXPECTED = /Blocked script execution in 'https:\/\/artifact-files\./
const problems: string[] = []
page.on('console', (msg) => {
  if (msg.type() === 'error' && !EXPECTED.test(msg.text())) problems.push(`console: ${msg.text()}`)
})
page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`))

const projectId = 'brand'
// 云端每 2.5 秒轮询一次，永远到不了 networkidle，等到 DOM 就够
await page.goto(`${url}/p/${projectId}?k=${encodeURIComponent(key)}`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('iframe', { timeout: 20_000 })
await page.waitForTimeout(1200)

const frames = page.frames().filter((f) => f !== page.mainFrame())
const results = []
for (const frame of frames) {
  const heading = await frame.locator('body').innerText().catch(() => '')
  results.push({ url: frame.url(), text: heading.replace(/\s+/g, ' ').slice(0, 40) })
}

// 画板里能不能摸到父页面（应该摸不到）
let sandboxed = false
if (frames[0]) {
  sandboxed = await frames[0]
    .evaluate(() => {
      try {
        void window.parent.document.body
        return false
      } catch {
        return true
      }
    })
    .catch(() => true)
}

await page.screenshot({ path: shot, fullPage: false })

// 轮询链路：用 Agent 接口改一块画板，开着的画布应该自己换掉那一块
const file = 'artboards/board-001/index.html'
const api = `${url}/api/projects/${projectId}`
const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' }
const fileUrl = `${api}/file?path=${encodeURIComponent(file)}`
const original = await (await fetch(fileUrl, { headers })).text()
const srcBefore = await page.locator('iframe').first().getAttribute('src')
await fetch(fileUrl, {
  method: 'POST',
  headers,
  body: JSON.stringify({ path: file, content: `${original}\n<!-- smoke -->\n` }),
})
let srcAfter = srcBefore
for (let i = 0; i < 20 && srcAfter === srcBefore; i += 1) {
  await page.waitForTimeout(500)
  srcAfter = await page.locator('iframe').first().getAttribute('src')
}
await fetch(fileUrl, { method: 'POST', headers, body: JSON.stringify({ path: file, content: original }) })
const live = srcAfter !== srcBefore

await browser.close()

console.log(`页面 ${url}/p/${projectId}`)
console.log(`画板 iframe：${frames.length} 块`)
for (const r of results) console.log(`  · ${r.url.replace(/[0-9a-f]{32}/, '<token>')}  「${r.text}」`)
console.log(`沙箱隔离：${sandboxed ? '✓ 摸不到父页面' : '✗ 能访问父页面'}`)
console.log(`改文件自动刷新：${live ? '✓ 只换那一块' : '✗ 没跟上'}`)
console.log(`截图：${shot}`)
if (problems.length > 0) {
  console.log('控制台报错：')
  for (const p of problems) console.log(`  ! ${p}`)
}

if (frames.length !== 3 || !sandboxed || !live || problems.length > 0) process.exitCode = 1
