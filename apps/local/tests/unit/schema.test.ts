import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CanvasError,
  emptyCanvas,
  formatCanvas,
  makeBoard,
  nextBoardPosition,
  parseCanvas,
  safeParseCanvas,
  type BoardSpec,
} from '../../shared/canvas-schema'

function sampleBoard(overrides: Partial<BoardSpec> = {}): BoardSpec {
  return {
    id: 'board-001',
    name: '品牌核心',
    x: 0,
    y: 0,
    width: 1440,
    height: 900,
    file: 'artboards/board-001/index.html',
    order: 1,
    ...overrides,
  }
}

function sampleDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...emptyCanvas('brand', 'Northstar 品牌'), boards: [sampleBoard()], ...overrides }
}

test('合法 canvas.json 通过解析，未知字段原样保留', () => {
  const raw = sampleDoc({ future: { a: 1 }, boards: [{ ...sampleBoard(), layerLabels: ['x'] }] })
  const doc = parseCanvas(raw)
  assert.equal(doc.id, 'brand')
  assert.equal(doc.boards.length, 1)
  assert.deepEqual(doc.future, { a: 1 })
  assert.deepEqual(doc.boards[0]?.layerLabels, ['x'])
})

test('协议版本不认识时给出 unsupported-protocol', () => {
  const err = (() => {
    try {
      parseCanvas(sampleDoc({ protocol: 99 }))
    } catch (e) {
      return e
    }
    return null
  })()
  assert.ok(err instanceof CanvasError)
  assert.equal(err.code, 'unsupported-protocol')
})

test('画板文件必须落在 artboards/<id>/index.html', () => {
  for (const file of ['../canvas.json', 'artboards/board-001/main.html', '/etc/passwd', 'board-001/index.html']) {
    assert.throws(() => parseCanvas(sampleDoc({ boards: [sampleBoard({ file })] })), CanvasError, file)
  }
})

test('画板 id 重复 / 宽高非正 / 坐标非数字都被拒绝', () => {
  assert.throws(() => parseCanvas(sampleDoc({ boards: [sampleBoard(), sampleBoard()] })), CanvasError)
  assert.throws(() => parseCanvas(sampleDoc({ boards: [sampleBoard({ width: 0 })] })), CanvasError)
  assert.throws(() => parseCanvas(sampleDoc({ boards: [sampleBoard({ x: Number.NaN })] })), CanvasError)
})

test('safeParseCanvas 对坏 JSON 返回错误而不是抛异常', () => {
  const result = safeParseCanvas('{ not json')
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, 'invalid-json')
})

test('formatCanvas 输出两空格缩进和末尾换行', () => {
  const text = formatCanvas(parseCanvas(sampleDoc()))
  assert.ok(text.endsWith('}\n'))
  assert.ok(text.includes('\n  "protocol"'))
})

test('nextBoardPosition 落在整体右侧、与最上面顶边对齐', () => {
  const pos = nextBoardPosition([
    sampleBoard({ id: 'board-001', x: 0, y: 100, width: 1000, height: 800 }),
    sampleBoard({ id: 'board-002', x: 1200, y: 0, width: 800, height: 600 }),
  ])
  assert.equal(pos.x, 2160)
  assert.equal(pos.y, 0)
})

test('makeBoard 生成的文件名与 id 一致，非法 id 抛错', () => {
  const board = makeBoard({ id: 'board-009', name: '新画板' })
  assert.equal(board.file, 'artboards/board-009/index.html')
  assert.equal(board.width, 1440)
  assert.throws(() => makeBoard({ id: 'Board 9', name: 'x' }), CanvasError)
})
