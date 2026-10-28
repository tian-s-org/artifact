/** 测试里读像素用：解 PNG（8 位、非隔行），算一块区域的平均色。 */
import { inflateSync } from 'node:zlib'

export interface Image {
  width: number
  height: number
  /** RGBA，每像素 4 字节 */
  data: Buffer
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

export function decodePng(buf: Buffer): Image {
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 8
  let colorType = 6
  let interlace = 0
  const idat: Buffer[] = []

  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    const start = offset + 8
    if (type === 'IHDR') {
      width = buf.readUInt32BE(start)
      height = buf.readUInt32BE(start + 4)
      bitDepth = buf[start + 8] ?? 8
      colorType = buf[start + 9] ?? 6
      interlace = buf[start + 12] ?? 0
    } else if (type === 'IDAT') {
      idat.push(buf.subarray(start, start + length))
    } else if (type === 'IEND') {
      break
    }
    offset = start + length + 4
  }

  if (bitDepth !== 8 || interlace !== 0) throw new Error('只支持 8 位非隔行 PNG')
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0
  if (channels === 0) throw new Error(`不支持的颜色类型 ${colorType}`)

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = Buffer.alloc(width * height * 4)
  const prevRow = new Uint8Array(stride)
  let read = 0

  for (let y = 0; y < height; y++) {
    const filter = raw[read++] ?? 0
    const line = raw.subarray(read, read + stride)
    read += stride
    const row = new Uint8Array(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? (row[i - channels] ?? 0) : 0
      const b = prevRow[i] ?? 0
      const c = i >= channels ? (prevRow[i - channels] ?? 0) : 0
      const value = line[i] ?? 0
      const pred =
        filter === 0 ? 0
        : filter === 1 ? a
        : filter === 2 ? b
        : filter === 3 ? (a + b) >> 1
        : filter === 4 ? paeth(a, b, c)
        : -1
      if (pred < 0) throw new Error(`未知过滤类型 ${filter}`)
      row[i] = (value + pred) & 0xff
    }
    prevRow.set(row)
    for (let x = 0; x < width; x++) {
      const src = x * channels
      const dst = (y * width + x) * 4
      const r = row[src] ?? 255
      pixels[dst] = r
      pixels[dst + 1] = channels >= 3 ? (row[src + 1] ?? 255) : r
      pixels[dst + 2] = channels >= 3 ? (row[src + 2] ?? 255) : r
      pixels[dst + 3] = channels === 4 ? (row[src + 3] ?? 255) : 255
    }
  }

  return { width, height, data: pixels }
}

export interface Rgb {
  r: number
  g: number
  b: number
}

/** 取中间一块（默认正中间 40% 区域）的平均色，避开边缘抗锯齿 */
export function averageColor(img: Image, fraction = 0.4): Rgb {
  const x0 = Math.floor((img.width * (1 - fraction)) / 2)
  const x1 = Math.ceil(img.width * (1 + fraction) / 2)
  const y0 = Math.floor((img.height * (1 - fraction)) / 2)
  const y1 = Math.ceil(img.height * (1 + fraction) / 2)
  let r = 0
  let g = 0
  let b = 0
  let count = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4
      r += img.data[i] ?? 0
      g += img.data[i + 1] ?? 0
      b += img.data[i + 2] ?? 0
      count++
    }
  }
  return { r: r / count, g: g / count, b: b / count }
}

export function near(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance
}
