import assert from 'node:assert/strict'
import test from 'node:test'
import { handleApi, type ApiContext } from '../../worker/api'
import { filesToken, verifyFilesToken, type Access } from '../../worker/auth'
import { handleFile } from '../../worker/files'
import { isServableFile, isWritableFile } from '../../worker/paths'
import { R2Storage } from '../../worker/storage'
import { MemoryBucket, makeEnv } from './fake'

const WRITE: Access = { allowed: true, keyFromUrl: null, canWrite: true }
const READONLY: Access = { allowed: true, keyFromUrl: null, canWrite: false }

function ctxFor(bucket: MemoryBucket): ApiContext {
  return { storage: new R2Storage(bucket) }
}

function callApi(bucket: MemoryBucket, path: string, init: RequestInit = {}, access: Access = WRITE): Promise<Response> {
  const request = new Request(`https://artifact.test${path}`, init)
  return handleApi(request, new URL(request.url), makeEnv(bucket), ctxFor(bucket), access)
}

const LAYOUT = JSON.stringify({
  protocol: 1,
  id: 'demo',
  name: '演示',
  boards: [
    { id: 'board-001', name: '首页', x: 0, y: 0, width: 1440, height: 900, file: 'artboards/board-001/index.html', order: 1 },
  ],
})

test('路径白名单：/f 只发 artboards/ 与 assets/，写入只认白名单', () => {
  assert.equal(isServableFile('artboards/board-001/index.html'), true)
  assert.equal(isServableFile('assets/images/a.png'), true)
  assert.equal(isServableFile('layout.json'), false)
  assert.equal(isServableFile('context.md'), false)
  assert.equal(isServableFile('design-system/rules.css'), false)
  assert.equal(isServableFile('artboards/board-001/.secret.html'), false)

  assert.equal(isWritableFile('layout.json'), true)
  assert.equal(isWritableFile('context.md'), true)
  assert.equal(isWritableFile('artboards/board-001/index.html'), true)
  assert.equal(isWritableFile('assets/css/base.css'), true)
  assert.equal(isWritableFile('versions/index.json'), false)
  assert.equal(isWritableFile('../layout.json'), false)
})

test('文件令牌：同一个部署稳定，改一个字符就不过', async () => {
  const env = makeEnv(new MemoryBucket(), { FILES_SECRET: 'secret' })
  const token = await filesToken(env)
  assert.equal(await verifyFilesToken(token, env), true)
  assert.equal(await verifyFilesToken(`${token.slice(0, 31)}x`, env), false)
})

test('空画布：/api/state 返回 layout=null', async () => {
  const bucket = new MemoryBucket()
  const res = await callApi(bucket, '/api/state')
  assert.equal(res.status, 200)
  const body = (await res.json()) as { layout: unknown; boards: unknown[] }
  assert.equal(body.layout, null)
  assert.deepEqual(body.boards, [])
})

test('推送整包 → state 里有 layout 与画板 mtime', async () => {
  const bucket = new MemoryBucket()
  const files = [
    { path: 'layout.json', content: LAYOUT },
    { path: 'artboards/board-001/index.html', content: '<!doctype html><title>首页</title>' },
  ]
  const push = await callApi(bucket, '/api/files', { method: 'POST', body: JSON.stringify({ files }) })
  assert.equal(push.status, 200)

  const res = await callApi(bucket, '/api/state')
  const body = (await res.json()) as {
    layout: { name: string }
    boards: Array<{ id: string; mtime: number; exists: boolean }>
    filesBase: string
  }
  assert.equal(body.layout.name, '演示')
  assert.equal(body.boards[0]?.id, 'board-001')
  assert.equal(body.boards[0]?.exists, true)
  assert.ok(body.boards[0]?.mtime && body.boards[0].mtime > 0)
  assert.match(body.filesBase, /\/f\/[a-f0-9]{32}$/)
})

test('第一次推送没带 layout.json 会被拒', async () => {
  const bucket = new MemoryBucket()
  const res = await callApi(bucket, '/api/files', {
    method: 'POST',
    body: JSON.stringify({ files: [{ path: 'artboards/board-001/index.html', content: '<!doctype html>' }] }),
  })
  assert.equal(res.status, 400)
})

test('写接口要写权限；路径不合法直接 400', async () => {
  const bucket = new MemoryBucket()
  const forbidden = await callApi(
    bucket,
    '/api/file?path=layout.json',
    { method: 'POST', body: JSON.stringify({ content: LAYOUT }) },
    READONLY,
  )
  assert.equal(forbidden.status, 403)

  const bad = await callApi(bucket, '/api/file?path=../evil.html', {
    method: 'POST',
    body: JSON.stringify({ content: 'x' }),
  })
  assert.equal(bad.status, 400)

  const badLayout = await callApi(bucket, '/api/file?path=layout.json', {
    method: 'POST',
    body: JSON.stringify({ content: '{oops' }),
  })
  assert.equal(badLayout.status, 400)
})

test('文件源：令牌不对 403；画板带沙箱 CSP，layout.json 取不到', async () => {
  const bucket = new MemoryBucket()
  const env = makeEnv(bucket, { FILES_SECRET: 'secret' })
  await callApi(bucket, '/api/files', {
    method: 'POST',
    body: JSON.stringify({
      files: [
        { path: 'layout.json', content: LAYOUT },
        { path: 'artboards/board-001/index.html', content: '<!doctype html><title>首页</title>' },
      ],
    }),
  })
  const token = await filesToken(env)
  const storage = new R2Storage(bucket)

  const ok = await handleFile(
    new Request(`https://artifact-files.test/f/${token}/artboards/board-001/index.html`),
    new URL(`https://artifact-files.test/f/${token}/artboards/board-001/index.html`),
    env,
    storage,
  )
  assert.equal(ok.status, 200)
  assert.match(ok.headers.get('content-security-policy') ?? '', /script-src 'none'/)
  assert.equal(ok.headers.get('access-control-allow-origin'), '*')

  const wrong = await handleFile(
    new Request(`https://artifact-files.test/f/${'0'.repeat(32)}/artboards/board-001/index.html`),
    new URL(`https://artifact-files.test/f/${'0'.repeat(32)}/artboards/board-001/index.html`),
    env,
    storage,
  )
  assert.equal(wrong.status, 403)

  const meta = await handleFile(
    new Request(`https://artifact-files.test/f/${token}/layout.json`),
    new URL(`https://artifact-files.test/f/${token}/layout.json`),
    env,
    storage,
  )
  assert.equal(meta.status, 403)
})
