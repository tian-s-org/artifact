/** EventProvider 的内存实现。将来换 Redis / WebSocket 只要换这个类。 */
import type { CanvasEvent, EventProvider } from './storage/types'

export class EventBus implements EventProvider {
  private listeners = new Set<(event: CanvasEvent) => void>()

  subscribe(listener: (event: CanvasEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  publish(event: CanvasEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (err) {
        console.error('[events] 监听器抛错', err)
      }
    }
  }

  get size(): number {
    return this.listeners.size
  }
}
