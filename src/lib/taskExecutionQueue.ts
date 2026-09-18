type QueueEntry = { taskId: string; run: () => Promise<void> }

export function createTaskExecutionQueue(maxConcurrent = 2) {
  const pending: QueueEntry[] = []
  const active = new Set<string>()
  const drain = () => {
    while (active.size < maxConcurrent && pending.length > 0) {
      const entry = pending.shift()!
      if (active.has(entry.taskId)) continue
      active.add(entry.taskId)
      void entry
        .run()
        .catch(() => undefined)
        .finally(() => {
          active.delete(entry.taskId)
          drain()
        })
    }
  }
  return {
    enqueue(taskId: string, run: () => Promise<void>) {
      if (active.has(taskId) || pending.some((entry) => entry.taskId === taskId)) return
      pending.push({ taskId, run })
      drain()
    },
    snapshot() {
      return { active: [...active], pending: pending.map((entry) => entry.taskId) }
    },
  }
}

export const taskExecutionQueue = createTaskExecutionQueue(2)
