import assert from 'node:assert/strict'
import test from 'node:test'
import { handleApi, type ApiContext } from '../../worker/api'
import {
  checkAccess,
  consumeCliCode,
  createCliCode,
  createCliToken,
  filesToken,
  readSession,
  sessionCookie,
  signSession,
  verifyCliToken,
  verifyFilesToken,
  type Access,
} from '../../worker/auth'
import { createCanvas, listCanvases, readMeta } from '../../worker/canvases'
import { handleFile } from '../../worker/files'
import { isServableFile, isWritableFile } from '../../worker/paths'
import { R2Storage } from '../../worker/storage'
import { MemoryBucket, makeEnv } from './fake'

const OWNER: Access = { allowed: true, canWrite: true, email: 'me@example.com' }
const OTHER: Access = { allowed: true, canWrite: true, email: 'other@example.com' }
const ANON: Access = { allowed: false, canWrite: false, email: null }

function ctxFor(bucket: MemoryBucket): ApiContext {
  return { storage: new R2Storage(bucket) }
}

function callApi(bucket: MemoryBucket, path: string, init: RequestInit = {}, access: Access = OWNER): Promise<Response> {
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

async function newCanvas(bucket: MemoryBucket): Promise<string> {
  const res = await callApi(bucket, '/api/canvases', { method: 'POST', body: JSON.stringify({ name: '演示' }) })
  assert.equal(res.status, 201)
  const body = (await res.json()) as { canvas: { id: string } }
  return body.canvas.id
}

test('路径白名单：/f 只发 artboards/ 与 assets/，写入只认白名单', () => {
  assert.equal(isServableFile('artboards/board-001/index.html'), true)
  assert.equal(isServableFile('assets/css/base.css'), true)
  assert.equal(isServableFile('layout.json'), false)
  assert.equal(isServableFile('context.md'), false)
  assert.equal(isServableFile('artboards/board-001/.secret.html'), false)

  assert.equal(isWritableFile('layout.json'), true)
  assert.equal(isWritableFile('artboards/board-001/index.html'), true)
  assert.equal(isWritableFile('../layout.json'), false)
})

test('文件令牌按画布算：换 id 就不过', async () => {
  const env = makeEnv(new MemoryBucket(), { SESSION_SECRET: 'secret' })
  const id = 'a'.repeat(24)
  const token = await filesToken(env, id)
  assert.equal(await verifyFilesToken(token, env, id), true)
  assert.equal(await verifyFilesToken(token, env, 'b'.repeat(24)), false)
})

test('画布归属：一个人可以有多块，列表只列自己的', async () => {
  const bucket = new MemoryBucket()
  const storage = new R2Storage(bucket)
  const one = await createCanvas(storage, 'me@example.com', '第一块')
  const two = await createCanvas(storage, 'me@example.com', '第二块')
  assert.notEqual(one.id, two.id)
  assert.equal((await readMeta(storage, one.id))?.owner, 'me@example.com')
  assert.deepEqual(
    (await listCanvases(storage, 'me@example.com')).map((c) => c.id).sort(),
    [one.id, two.id].sort(),
  )
  assert.deepEqual(await listCanvases(storage, 'other@example.com'), [])
})

test('画布列表接口要登录；新建后能看到', async () => {
  const bucket = new MemoryBucket()
  assert.equal((await callApi(bucket, '/api/canvases', {}, ANON)).status, 401)
  const id = await newCanvas(bucket)
  const res = await callApi(bucket, '/api/canvases')
  const body = (await res.json()) as { canvases: Array<{ id: string }> }
  assert.deepEqual(
    body.canvases.map((c) => c.id),
    [id],
  )
})

test('推送整包 → 链接可直接读状态；非所有者不能写', async () => {
  const bucket = new MemoryBucket()
  const id = await newCanvas(bucket)
  const files = [
    { path: 'layout.json', content: LAYOUT },
    { path: 'artboards/board-001/index.html', content: '<!doctype html><title>首页</title>' },
  ]
  const push = await callApi(bucket, `/api/c/${id}/files`, { method: 'POST', body: JSON.stringify({ files }) })
  assert.equal(push.status, 200)

  const state = await callApi(bucket, `/api/c/${id}/state`, {}, ANON)
  assert.equal(state.status, 200)
  const body = (await state.json()) as {
    layout: { name: string }
    boards: Array<{ id: string; exists: boolean }>
    filesBase: string
  }
  assert.equal(body.layout.name, '演示')
  assert.equal(body.boards[0]?.exists, true)
  assert.match(body.filesBase, /\/f\/[a-f0-9]{32}\/[a-f0-9]{24}$/)

  const foreign = await callApi(
    bucket,
    `/api/c/${id}/files`,
    { method: 'POST', body: JSON.stringify({ files }) },
    OTHER,
  )
  assert.equal(foreign.status, 403)

  const anonWrite = await callApi(
    bucket,
    `/api/c/${id}/file?path=context.md`,
    { method: 'POST', body: JSON.stringify({ content: 'x' }) },
    ANON,
  )
  assert.equal(anonWrite.status, 403)
})

test('第一次推送没带 layout.json 会被拒；未知画布 404', async () => {
  const bucket = new MemoryBucket()
  const id = await newCanvas(bucket)
  const res = await callApi(bucket, `/api/c/${id}/files`, {
    method: 'POST',
    body: JSON.stringify({ files: [{ path: 'artboards/board-001/index.html', content: '<!doctype html>' }] }),
  })
  assert.equal(res.status, 400)

  const missing = await callApi(bucket, `/api/c/${'0'.repeat(24)}/state`, {}, ANON)
  assert.equal(missing.status, 404)
})

test('文件源：令牌按画布校验；画板带沙箱 CSP，layout.json 取不到', async () => {
  const bucket = new MemoryBucket()
  const env = makeEnv(bucket, { SESSION_SECRET: 'secret' })
  const id = await newCanvas(bucket)
  await callApi(bucket, `/api/c/${id}/files`, {
    method: 'POST',
    body: JSON.stringify({
      files: [
        { path: 'layout.json', content: LAYOUT },
        { path: 'artboards/board-001/index.html', content: '<!doctype html><title>首页</title>' },
      ],
    }),
  })
  const token = await filesToken(env, id)
  const storage = new R2Storage(bucket)

  const ok = await handleFile(
    new Request(`https://artifact-files.test/f/${token}/${id}/artboards/board-001/index.html`),
    new URL(`https://artifact-files.test/f/${token}/${id}/artboards/board-001/index.html`),
    env,
    storage,
  )
  assert.equal(ok.status, 200)
  assert.match(ok.headers.get('content-security-policy') ?? '', /script-src 'none'/)

  const wrong = await handleFile(
    new Request(`https://artifact-files.test/f/${'0'.repeat(32)}/${id}/artboards/board-001/index.html`),
    new URL(`https://artifact-files.test/f/${'0'.repeat(32)}/${id}/artboards/board-001/index.html`),
    env,
    storage,
  )
  assert.equal(wrong.status, 403)

  const meta = await handleFile(
    new Request(`https://artifact-files.test/f/${token}/${id}/layout.json`),
    new URL(`https://artifact-files.test/f/${token}/${id}/layout.json`),
    env,
    storage,
  )
  assert.equal(meta.status, 403)
})

test('Google 会话：签名、过期、白名单', async () => {
  const env = makeEnv(new MemoryBucket(), {
    GOOGLE_CLIENT_ID: 'id',
    GOOGLE_CLIENT_SECRET: 'secret',
    ALLOWED_EMAILS: 'me@example.com',
    ALLOWED_DOMAIN: 'tian-s.org',
  })
  const cookie = await sessionCookie({ email: 'me@example.com', exp: Date.now() + 1000 }, env)
  const request = new Request('https://artifact.test/', { headers: { cookie: cookie.split(';')[0] ?? '' } })
  assert.equal((await readSession(request, env))?.email, 'me@example.com')

  const expired = await signSession({ email: 'me@example.com', exp: Date.now() - 1 }, env)
  const expiredReq = new Request('https://artifact.test/', { headers: { cookie: `artifact_session=${expired}` } })
  assert.equal(await readSession(expiredReq, env), null)
})

test('访问判定：没配 Google 全放开；配了要会话或 CLI token', async () => {
  const bucket = new MemoryBucket()
  const openEnv = makeEnv(bucket)
  assert.equal((await checkAccess(new Request('https://artifact.test/'), openEnv, new R2Storage(bucket))).allowed, true)

  const env = makeEnv(bucket, { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' })
  const storage = new R2Storage(bucket)
  assert.equal((await checkAccess(new Request('https://artifact.test/'), env, storage)).allowed, false)

  const cookie = await sessionCookie({ email: 'me@example.com', exp: Date.now() + 1000 }, env)
  const withSession = new Request('https://artifact.test/', { headers: { cookie: cookie.split(';')[0] ?? '' } })
  assert.equal((await checkAccess(withSession, env, storage)).email, 'me@example.com')

  const token = await createCliToken(storage, 'me@example.com')
  const withToken = new Request('https://artifact.test/', { headers: { authorization: `Bearer ${token}` } })
  const access = await checkAccess(withToken, env, storage)
  assert.equal(access.email, 'me@example.com')
  assert.equal(access.canWrite, true)
})

test('CLI 授权：一次性 code 只能换一次，token 记得是谁', async () => {
  const bucket = new MemoryBucket()
  const storage = new R2Storage(bucket)
  const code = await createCliCode(storage, 'http://127.0.0.1:1234/callback', 'me@example.com')
  const payload = await consumeCliCode(storage, code)
  assert.equal(payload?.email, 'me@example.com')
  assert.equal(await consumeCliCode(storage, code), null, 'code 用完即焚')

  const token = await createCliToken(storage, 'me@example.com')
  assert.equal(await verifyCliToken(storage, token), 'me@example.com')
  assert.equal(await verifyCliToken(storage, 'f'.repeat(48)), null)
})
