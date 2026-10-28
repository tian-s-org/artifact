/**
 * 每项目一条写队列。画布写回 x/y、Agent 改 canvas.json、版本保存/恢复都从这里排队，
 * 避免「读-改-写」互相覆盖。跨项目并行。
 */
const locks = new Map<string, Promise<unknown>>()

export function withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(projectId) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  locks.set(
    projectId,
    next.catch(() => undefined),
  )
  return next
}
