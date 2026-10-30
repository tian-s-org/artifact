import assert from 'node:assert/strict'
import test from 'node:test'
import { readDeepLink } from '../../src/canvas/deep-link'
import type { BoardView } from '../../src/canvas/types'

function board(id: string, x: number, overrides: Partial<BoardView> = {}): BoardView {
  return {
    id,
    name: id,
    index: 1,
    x,
    y: 0,
    width: 1440,
    height: 900,
    src: `/files/demo/artboards/${id}/index.html?v=1`,
    ...overrides,
  }
}

const boards = [board('board-001', 0), board('board-002', 1600, { width: 1024, height: 768 })]

test('没有查询参数时不给深链', () => {
  assert.equal(readDeepLink('', boards), null)
  assert.equal(readDeepLink('?other=1', boards), null)
})

test('focus 命中画板时给出它的世界矩形', () => {
  const deep = readDeepLink('?focus=board-002', boards)
  assert.deepEqual(deep?.rect, { x: 1600, y: 0, width: 1024, height: 768 })
  assert.equal(deep?.scale, null)
})

test('focus 指向不存在的画板时忽略，scale 仍然生效', () => {
  const deep = readDeepLink('?focus=board-999&scale=0.5', boards)
  assert.equal(deep?.rect, null)
  assert.equal(deep?.scale, 0.5)
})

test('只给 scale 时不给矩形', () => {
  const deep = readDeepLink('?scale=2', boards)
  assert.deepEqual(deep, { rect: null, scale: 2 })
})

test('scale 越界或不是数字时当作没写', () => {
  assert.equal(readDeepLink('?scale=abc', boards), null)
  assert.equal(readDeepLink('?scale=0', boards), null)
  assert.equal(readDeepLink('?scale=-3', boards), null)
  assert.deepEqual(readDeepLink('?focus=board-001&scale=99', boards), {
    rect: { x: 0, y: 0, width: 1440, height: 900 },
    scale: null,
  })
})
