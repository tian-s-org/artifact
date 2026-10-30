/**
 * canvas.json 的协议定义与校验。前端与服务端共用同一份：
 * 服务端写盘前用它兜底，前端读到坏数据时用它判断「停在上一份好数据」。
 *
 * 解析只校验、不改写——未知字段原样保留，方便协议往后加东西而不破坏旧客户端。
 */

export const PROTOCOL_VERSION = 1

/** 画板 id 与项目 id 同一规则，同时也是文件系统里的目录名 */
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

/** 画板文件必须落在 artboards/ 下、以 .html 结尾，且不能穿出项目目录 */
const BOARD_FILE_RE = /^artboards\/[a-z0-9][a-z0-9-]{0,63}\/index\.html$/

export interface BoardSpec {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  /** 相对项目根目录的 POSIX 路径 */
  file: string
  order?: number
  [key: string]: unknown
}

export interface CanvasDoc {
  protocol: number
  id: string
  name: string
  context?: string
  boards: BoardSpec[]
  [key: string]: unknown
}

export class CanvasError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'CanvasError'
    this.code = code
  }
}

export function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value)
}

export function isBoardFile(value: unknown): value is string {
  return typeof value === 'string' && BOARD_FILE_RE.test(value)
}

function fail(code: string, message: string): never {
  throw new CanvasError(code, message)
}

function requireString(obj: Record<string, unknown>, key: string, code = 'invalid'): string {
  const value = obj[key]
  if (typeof value !== 'string' || value.trim() === '') fail(code, `字段 ${key} 必须是非空字符串`)
  return value
}

function requireFinite(obj: Record<string, unknown>, key: string, code = 'invalid'): number {
  const value = obj[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(code, `字段 ${key} 必须是有限数字`)
  return value
}

function parseBoard(raw: unknown, index: number): BoardSpec {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('invalid', `boards[${index}] 必须是对象`)
  const board = raw as Record<string, unknown>
  const id = requireString(board, 'id')
  if (!isId(id)) fail('invalid', `boards[${index}].id 不合法：${id}`)
  const file = requireString(board, 'file')
  if (!isBoardFile(file)) fail('invalid', `boards[${index}].file 必须形如 artboards/${id}/index.html`)
  const width = requireFinite(board, 'width')
  const height = requireFinite(board, 'height')
  if (width <= 0 || height <= 0) fail('invalid', `boards[${index}] 的宽高必须为正数`)
  const name = requireString(board, 'name')
  const x = requireFinite(board, 'x')
  const y = requireFinite(board, 'y')
  if (board.order !== undefined && typeof board.order !== 'number') fail('invalid', `boards[${index}].order 必须是数字`)
  return { ...(board as BoardSpec), id, name, x, y, width, height, file }
}

/** 严格版：不合法直接抛 CanvasError */
export function parseCanvas(raw: unknown): CanvasDoc {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('invalid', 'canvas.json 顶层必须是对象')
  const doc = raw as Record<string, unknown>
  const protocol = requireFinite(doc, 'protocol')
  if (protocol !== PROTOCOL_VERSION) fail('unsupported-protocol', `协议版本 ${protocol} 不受支持（当前支持 ${PROTOCOL_VERSION}）`)
  const id = requireString(doc, 'id')
  if (!isId(id)) fail('invalid', `项目 id 不合法：${id}`)
  const name = requireString(doc, 'name')
  const boardsRaw = doc.boards
  if (!Array.isArray(boardsRaw)) fail('invalid', 'boards 必须是数组')
  const boards = boardsRaw.map((b, i) => parseBoard(b, i))
  const seen = new Set<string>()
  for (const board of boards) {
    if (seen.has(board.id)) fail('invalid', `画板 id 重复：${board.id}`)
    seen.add(board.id)
  }
  return { ...(doc as unknown as CanvasDoc), protocol, id, name, boards }
}

export type ParseResult =
  | { ok: true; doc: CanvasDoc }
  | { ok: false; error: { code: string; message: string } }

/** 宽松版：给前端用，坏数据不抛异常 */
export function safeParseCanvas(text: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return { ok: false, error: { code: 'invalid-json', message: `canvas.json 不是合法 JSON：${(err as Error).message}` } }
  }
  try {
    return { ok: true, doc: parseCanvas(raw) }
  } catch (err) {
    if (err instanceof CanvasError) return { ok: false, error: { code: err.code, message: err.message } }
    return { ok: false, error: { code: 'invalid', message: (err as Error).message } }
  }
}

/** 序列化：两空格缩进 + 末尾换行，方便人和 Agent 读 diff */
export function formatCanvas(doc: CanvasDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`
}

/** 画板之间的默认间距（新建画板时用） */
export const NEW_BOARD_GAP = 160

export function emptyCanvas(id: string, name: string): CanvasDoc {
  return {
    protocol: PROTOCOL_VERSION,
    id,
    name,
    context: 'context.md',
    boards: [],
  }
}

/** 新画板落在现有画板整体右侧、与最上面一块顶边对齐 */
export function nextBoardPosition(boards: BoardSpec[]): { x: number; y: number } {
  if (boards.length === 0) return { x: 0, y: 0 }
  let right = -Infinity
  let top = Infinity
  for (const b of boards) {
    right = Math.max(right, b.x + b.width)
    top = Math.min(top, b.y)
  }
  return { x: Math.round(right + NEW_BOARD_GAP), y: Math.round(top) }
}

export function makeBoard(input: {
  id: string
  name: string
  width?: number
  height?: number
  x?: number
  y?: number
  order?: number
}): BoardSpec {
  const { id, name } = input
  if (!isId(id)) throw new CanvasError('invalid', `画板 id 不合法：${id}`)
  return {
    id,
    name,
    x: input.x ?? 0,
    y: input.y ?? 0,
    width: input.width ?? 1440,
    height: input.height ?? 900,
    file: `artboards/${id}/index.html`,
    order: input.order ?? 1,
  }
}
