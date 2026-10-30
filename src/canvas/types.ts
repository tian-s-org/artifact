export interface BoardView {
  id: string
  name: string
  /** 画布上的阅读序号，从 1 开始（按 order 排完后的位置） */
  index: number
  /** 画布世界坐标 */
  x: number
  y: number
  width: number
  height: number
  /** 设计文件地址，带 ?v=<mtime> 以便只在内容变化时重载 */
  src: string
  /** layout.json 里登记了，但磁盘上没有这个文件 */
  missing?: boolean
}
