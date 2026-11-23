export type TaskDataResetHandler = () => void | (() => void) | Promise<void | (() => void)>

const CHANNEL_NAME = 'amazon-image-studio:task-data-reset'
const SIGNAL_KEY = 'amazon-image-studio:task-data-reset'
const handlers = new Set<TaskDataResetHandler>()
let channel: BroadcastChannel | undefined
let stopListening: (() => void) | undefined

/** Listeners must cancel pending work and discard every task-backed view before resolving. */
export function subscribeTaskDataReset(handler: TaskDataResetHandler, refresh: () => Promise<void>): () => void {
  handlers.add(handler)
  if (typeof window !== 'undefined' && !stopListening) {
    const check = () =>
      void refresh().catch(() => {
        /* The database fence remains closed on failure. */
      })
    const onStorage = (event: StorageEvent) => {
      if (event.key === SIGNAL_KEY) check()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') check()
    }
    try {
      channel = new BroadcastChannel(CHANNEL_NAME)
      channel.onmessage = check
    } catch {
      // Storage notifications and focus checks also support browsers without BroadcastChannel.
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', check)
    window.addEventListener('pageshow', check)
    document.addEventListener('visibilitychange', onVisibility)
    stopListening = () => {
      channel?.close()
      channel = undefined
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', check)
      window.removeEventListener('pageshow', check)
      document.removeEventListener('visibilitychange', onVisibility)
      stopListening = undefined
    }
  }
  return () => {
    handlers.delete(handler)
    if (!handlers.size) stopListening?.()
  }
}

/** Optional callbacks run synchronously only after the database has accepted the new epoch. */
export async function runTaskDataResetHandlers(): Promise<Array<() => void> | undefined> {
  if (!handlers.size) return undefined
  const afterAccept: Array<() => void> = []
  for (const handler of [...handlers]) {
    const callback = await handler()
    if (callback) afterAccept.push(callback)
  }
  return afterAccept
}

/** Notifications are hints only: the IndexedDB transaction is the authoritative write fence. */
export function broadcastTaskDataReset(epoch: string): void {
  if (typeof window === 'undefined') return
  try {
    if (channel) channel.postMessage(epoch)
    else {
      const sender = new BroadcastChannel(CHANNEL_NAME)
      sender.postMessage(epoch)
      sender.close()
    }
  } catch {
    /* Cross-tab storage and focus checks remain available. */
  }
  try {
    window.localStorage.setItem(SIGNAL_KEY, epoch)
  } catch {
    /* A blocked storage area cannot bypass the database fence. */
  }
}
