type QueueEntry = { taskId: string; run: () => Promise<void> }

export function createTaskExecutionQueue(maxConcurrent = 2) {
  const pending: QueueEntry[] = []
  const active = new Map<string, QueueEntry>()
  // Detached remote polling must still be deduplicated, but does not occupy a submit slot.
  const inFlight = new Map<string, QueueEntry>()
  const drain = () => {
    while (active.size < maxConcurrent && pending.length > 0) {
      const entry = pending.shift()!
      if (inFlight.has(entry.taskId)) continue
      active.set(entry.taskId, entry)
      inFlight.set(entry.taskId, entry)
      void (async () => entry.run())()
        .catch(() => undefined)
        .finally(() => {
          if (inFlight.get(entry.taskId) !== entry) return
          inFlight.delete(entry.taskId)
          if (active.get(entry.taskId) === entry) active.delete(entry.taskId)
          drain()
        })
    }
  }
  return {
    enqueue(taskId: string, run: () => Promise<void>) {
      if (inFlight.has(taskId) || pending.some((entry) => entry.taskId === taskId)) return
      pending.push({ taskId, run })
      drain()
    },
    release(taskId: string) {
      active.delete(taskId)
      drain()
    },
    cancel(taskId: string) {
      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i].taskId === taskId) pending.splice(i, 1)
      }
      active.delete(taskId)
      inFlight.delete(taskId)
      drain()
    },
    cancelAll() {
      pending.length = 0
      active.clear()
      inFlight.clear()
    },
    snapshot() {
      return { active: [...active.keys()], pending: pending.map((entry) => entry.taskId) }
    },
  }
}

export const taskExecutionQueue = createTaskExecutionQueue(2)
