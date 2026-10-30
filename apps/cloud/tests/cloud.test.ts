import assert from 'node:assert/strict'
import test from 'node:test'
import type { Access } from '../src/auth'
import { filesToken, verifyFilesToken } from '../src/auth'
import { handleApi } from '../src/api'
import { isServableFile, isWritableFile } from '../src/paths'
import { CloudProjectRepository } from '../src/repo'
import { R2Storage } from '../src/storage'
import { CloudVersionStore } from '../src/versions'
import { handleFile } from '../src/files'
import { MemoryBucket, makeEnv } from './fake'

const WRITE: Access = { allowed: true, keyFromUrl: null, canWrite: true }
const READONLY: Access = { allowed: true, keyFromUrl: null, canWrite: false }

function ctxFor(bucket: MemoryBucket) {
  const storage = new R2Storage(bucket)
  return { storage, repo: new CloudProjectRepository(storage), versions: new CloudVersionStore(storage) }
}

async function callApi(
  bucket: MemoryBucket,
  path: string,
  init: RequestInit = {},
  access: Access = WRITE,
  envOverrides = {},
) {
  const env = makeEnv(bucket, envOverrides)
  const request = new Request(`https://artifact.test${path}`, init)
  return handleApi(request, new URL(request.url), env, ctxFor(bucket), access)
}

test('路径白名单：/f 只发三个目录，写入也拦住 versions 与点文件', () => {
  assert.equal(isServableFile('artboards/board-001/index.html'), true)
  assert.equal(isServableFile('assets/images/a.png'), true)
  assert.equal(isServableFile('design-system/rules.css'), true)

  assert.equal(isServableFile('canvas.json'), false)
  assert.equal(isServableFile('context.md'), false)
  assert.equal(isServableFile('versions/index.json'), false)
  assert.equal(isServableFile('artboards/.secret'), false)
  assert.equal(isServableFile('artboards/../canvas.json'), false)
  assert.equal(isServableFile('artboards/a.bin'), false)

  assert.equal(isWritableFile('canvas.json'), true)
  assert.equal(isWritableFile('context.md'), true)
  assert.equal(isWritableFile('artboards/board-001/index.html'), true)
  assert.equal(isWritableFile('versions/index.json'), false)
  assert.equal(isWritableFile('other/x.txt'), false)
})

test('文件令牌：同一项目稳定，改一个字符就失效', async () => {
  const env = makeEnv(new MemoryBucket(), { SITE_KEY: 'site-key', FILES_SECRET: 'file-secret' })
  const token = await filesToken('brand', env)
  assert.equal(token.length, 32)
  assert.equal(await filesToken('brand', env), token, '同一项目每次算出来应该一样')
  assert.notEqual(await filesToken('other', env), token)
  assert.equal(await verifyFilesToken('brand', token, env), true)
  assert.equal(await verifyFilesToken('brand', `${token.slice(0, 31)}x`, env), false)
})

test('项目仓库：建项目写骨架，建画板自动摆位并写 HTML', async () => {
  const bucket = new MemoryBucket()
  const { repo } = ctxFor(bucket)
  const doc = await repo.createProject({ id: 'brand', name: '品牌' })
  assert.equal(doc.boards.length, 0)
  assert.match(bucket.text('brand/context.md'), /项目背景/)
  assert.equal(bucket.text('brand/design-system/tokens.json'), '', '不再脚手架设计规范文件')

  const board = await repo.addBoard('brand', { id: 'board-001', name: '首页', width: 1200, height: 800 })
  assert.equal(board.file, 'artboards/board-001/index.html')
  assert.match(bucket.text('brand/artboards/board-001/index.html'), /首页/)

  const second = await repo.addBoard('brand', { id: 'board-002', name: '方案二' })
  assert.equal(second.x, 1200 + 160, '第二块画板摆在第一块右边，留 160 间距')

  await assert.rejects(() => repo.createProject({ id: 'brand', name: '重复' }), /已存在/)
  await assert.rejects(() => repo.addBoard('brand', { id: 'board-001', name: '重复' }), /已存在/)
})

test('版本：保存、改画板、恢复，另一块画板不动', async () => {
  const bucket = new MemoryBucket()
  const { repo, versions } = ctxFor(bucket)
  await repo.createProject({ id: 'brand', name: '品牌' })
  await repo.addBoard('brand', { id: 'board-001', name: '一' })
  await repo.addBoard('brand', { id: 'board-002', name: '二' })

  const one = 'artboards/board-001/index.html'
  const two = 'artboards/board-002/index.html'
  const saved = await versions.save('brand', '基线')
  assert.match(saved.id, /^v\d{8}-\d{6}/)

  const beforeTwo = bucket.map.get(`brand/${two}`)?.uploaded?.getTime()
  await bucket.put(`brand/${one}`, '<html>改过的一</html>')
  await bucket.put(`brand/${two}`, '<html>改过的二</html>')
  const afterTwo = bucket.map.get(`brand/${two}`)?.uploaded?.getTime()
  assert.notEqual(afterTwo, beforeTwo)

  const result = await versions.restore('brand', saved.id)
  assert.deepEqual(result.restored.sort(), ['board-001', 'board-002'])
  assert.match(bucket.text(`brand/${one}`), /<h1>一<\/h1>/)
  assert.match(bucket.text(`brand/${two}`), /<h1>二<\/h1>/)
  assert.notEqual(bucket.map.get(`brand/${two}`)?.uploaded?.getTime(), afterTwo, '被改过的画板要写回来')

  // 再恢复一次：内容和这一版已经一样，两个画板都不该重写
  const settled = bucket.map.get(`brand/${two}`)?.uploaded?.getTime()
  await versions.restore('brand', saved.id)
  assert.equal(bucket.map.get(`brand/${two}`)?.uploaded?.getTime(), settled, '内容一致就不重写')

  const index = await versions.list('brand')
  assert.equal(index.length, 3)
  assert.equal(index[0]?.auto, true, '恢复前自动留一份备份')
})

test('单画板恢复：只写那一块，canvas.json 不动', async () => {
  const bucket = new MemoryBucket()
  const { repo, versions } = ctxFor(bucket)
  await repo.createProject({ id: 'brand', name: '品牌' })
  await repo.addBoard('brand', { id: 'board-001', name: '一' })
  await repo.addBoard('brand', { id: 'board-002', name: '二' })
  const saved = await versions.save('brand', '基线')

  const canvasBefore = bucket.text('brand/canvas.json')
  await bucket.put('brand/artboards/board-001/index.html', '<html>一改</html>')
  await bucket.put('brand/artboards/board-002/index.html', '<html>二改</html>')
  await bucket.put('brand/canvas.json', canvasBefore.replace('"name": "品牌"', '"name": "新名字"'))

  const result = await versions.restore('brand', saved.id, { boardId: 'board-002' })
  assert.deepEqual(result.restored, ['board-002'])
  assert.match(bucket.text('brand/artboards/board-001/index.html'), /一改/, '别的画板保持现状')
  assert.match(bucket.text('brand/canvas.json'), /新名字/, 'canvas.json 不该被恢复整版覆盖')
})

test('API：项目详情给出沙箱源地址，写文件要钥匙', async () => {
  const bucket = new MemoryBucket()
  const { repo } = ctxFor(bucket)
  await repo.createProject({ id: 'brand', name: '品牌' })

  const res = await callApi(bucket, '/api/projects/brand')
  assert.equal(res.status, 200)
  const payload = (await res.json()) as { filesBase: string; boards: unknown[] }
  assert.match(payload.filesBase, /^https:\/\/artifact-files\.test\/f\/brand\/[0-9a-f]{32}$/)

  const denied = await callApi(
    bucket,
    '/api/projects/brand/file',
    { method: 'POST', body: JSON.stringify({ path: 'artboards/board-001/index.html', content: '<html></html>' }) },
    READONLY,
  )
  assert.equal(denied.status, 403)

  const ok = await callApi(bucket, '/api/projects/brand/file', {
    method: 'POST',
    body: JSON.stringify({ path: 'artboards/board-001/index.html', content: '<html>hi</html>' }),
  })
  assert.equal(ok.status, 200)
  assert.equal(bucket.text('brand/artboards/board-001/index.html'), '<html>hi</html>')

  const bad = await callApi(bucket, '/api/projects/brand/file', {
    method: 'POST',
    body: JSON.stringify({ path: 'canvas.json', content: JSON.stringify({ protocol: 1, id: 'other', name: 'x', boards: [] }) }),
  })
  assert.equal(bad.status, 400, 'canvas.json 的 id 必须和项目一致')

  const escape = await callApi(bucket, '/api/projects/brand/file', {
    method: 'POST',
    body: JSON.stringify({ path: '../other/canvas.json', content: '{}' }),
  })
  assert.equal(escape.status, 400)

  // 删也用 POST（Cloudflare 挡 DELETE），靠 op=delete 区分
  const removed = await callApi(bucket, '/api/projects/brand/file?path=artboards/board-001/index.html&op=delete', {
    method: 'POST',
  })
  assert.equal(removed.status, 200)
  assert.equal(bucket.text('brand/artboards/board-001/index.html'), '', '文件已删掉')
})

test('文件服务：令牌不对 403，白名单外 403，画板 HTML 带沙箱 CSP', async () => {
  const bucket = new MemoryBucket()
  await bucket.put('brand/artboards/board-001/index.html', '<html>ok</html>')
  const env = makeEnv(bucket)
  const token = await filesToken('brand', env)

  const good = new Request(`https://artifact-files.test/f/brand/${token}/artboards/board-001/index.html`)
  const res = await handleFile(good, new URL(good.url), env, new R2Storage(bucket))
  assert.equal(res.status, 200)
  const csp = res.headers.get('content-security-policy') ?? ''
  assert.match(csp, /script-src 'none'/)
  assert.match(csp, /sandbox/)
  assert.match(csp, /img-src https:\/\/artifact-files\.test/)
  assert.equal(res.headers.get('access-control-allow-origin'), '*')

  const badToken = new Request(`https://artifact-files.test/f/brand/${'0'.repeat(32)}/artboards/board-001/index.html`)
  assert.equal((await handleFile(badToken, new URL(badToken.url), env, new R2Storage(bucket))).status, 403)

  const outside = new Request(`https://artifact-files.test/f/brand/${token}/canvas.json`)
  assert.equal((await handleFile(outside, new URL(outside.url), env, new R2Storage(bucket))).status, 403)
})
