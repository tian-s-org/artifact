#!/usr/bin/env node
/**
 * 校验一个画布项目：layout.json 的字段，以及每块画板的文件是否存在。
 * 只读，不改任何文件；没有依赖，直接 node 跑。
 *
 *   node scripts/validate.mjs [项目根]    # 默认当前目录
 */
import fs from 'node:fs'
import path from 'node:path'

const USAGE = `validate.mjs —— 校验画布项目

用法：
  node scripts/validate.mjs [项目根]

  [项目根]   包含 layout.json 的目录，通常是 <项目>/.artifact（默认当前目录）

检查：
  layout.json 的 protocol / id / name / boards 字段
  每块画板的 file 是否为 artboards/<id>/index.html、文件是否存在且非空

输出：
  stdout 是 JSON 结果；错误同时写到 stderr；有错时退出码 1。`

const argv = process.argv.slice(2)
if (argv.includes('-h') || argv.includes('--help')) {
  console.log(USAGE)
  process.exit(0)
}
if (argv.length > 1) {
  console.error(`Error: 最多接受一个参数（项目根），收到 ${argv.length} 个：${argv.join(' ')}\n`)
  console.error(USAGE)
  process.exit(2)
}

const root = path.resolve(argv[0] ?? '.')
const errors = []
const fail = (file, message) => errors.push({ file, message })
const isId = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value)

let doc
const canvasPath = path.join(root, 'layout.json')
if (!fs.existsSync(canvasPath)) {
  fail('layout.json', `找不到 ${canvasPath}。项目根应指向含 layout.json 的 .artifact/ 目录`)
} else {
  try {
    doc = JSON.parse(fs.readFileSync(canvasPath, 'utf8'))
  } catch (err) {
    fail('layout.json', `不是合法 JSON：${err.message}`)
  }
}

if (doc !== undefined) {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    fail('layout.json', '顶层必须是对象')
  } else {
    if (doc.protocol !== 1) fail('layout.json', `protocol 必须是 1，收到 ${JSON.stringify(doc.protocol)}`)
    if (!isId(doc.id)) fail('layout.json', `id 不合法：${JSON.stringify(doc.id)}；只允许小写字母、数字、连字符`)
    if (typeof doc.name !== 'string' || doc.name.trim() === '') fail('layout.json', 'name 必须是非空字符串')

    if (!Array.isArray(doc.boards)) {
      fail('layout.json', 'boards 必须是数组')
    } else {
      const seen = new Set()
      doc.boards.forEach((board, index) => {
        const at = `boards[${index}]`
        if (board === null || typeof board !== 'object' || Array.isArray(board)) {
          fail('layout.json', `${at} 必须是对象`)
          return
        }
        if (!isId(board.id)) {
          fail('layout.json', `${at}.id 不合法：${JSON.stringify(board.id)}`)
        } else if (seen.has(board.id)) {
          fail('layout.json', `${at}.id 重复：${board.id}`)
        } else {
          seen.add(board.id)
        }
        if (typeof board.name !== 'string' || board.name.trim() === '') fail('layout.json', `${at}.name 必须是非空字符串`)
        for (const key of ['x', 'y']) {
          if (!Number.isFinite(board[key])) fail('layout.json', `${at}.${key} 必须是有限数字，收到 ${JSON.stringify(board[key])}`)
        }
        for (const key of ['width', 'height']) {
          if (!Number.isFinite(board[key]) || board[key] <= 0) {
            fail('layout.json', `${at}.${key} 必须是正数，收到 ${JSON.stringify(board[key])}`)
          }
        }
        const expected = `artboards/${board.id}/index.html`
        if (board.file !== expected) {
          fail('layout.json', `${at}.file 必须是 ${expected}，收到 ${JSON.stringify(board.file)}`)
          return
        }
        const abs = path.join(root, expected)
        if (!fs.existsSync(abs)) fail(expected, '文件不存在')
        else if (fs.statSync(abs).size === 0) fail(expected, '文件是空的')
      })
    }
  }
}

for (const error of errors) console.error(`✗ ${error.file}: ${error.message}`)
console.log(
  JSON.stringify(
    {
      ok: errors.length === 0,
      root,
      boards: doc && Array.isArray(doc.boards) ? doc.boards.length : 0,
      errors,
    },
    null,
    2,
  ),
)
process.exit(errors.length === 0 ? 0 : 1)
