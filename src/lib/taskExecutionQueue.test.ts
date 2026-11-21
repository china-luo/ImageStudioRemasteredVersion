import { describe, expect, it, vi } from 'vitest'
import { createTaskExecutionQueue } from './taskExecutionQueue'

describe('task execution queue', () => {
  it('limits concurrent work and drains pending tasks', async () => {
    const queue = createTaskExecutionQueue(2)
    const resolvers: Array<() => void> = []
    const run = vi.fn(() => new Promise<void>((resolve) => resolvers.push(resolve)))
    queue.enqueue('a', run)
    queue.enqueue('b', run)
    queue.enqueue('c', run)
    expect(queue.snapshot()).toEqual({ active: ['a', 'b'], pending: ['c'] })
    resolvers[0]()
    await vi.waitFor(() => expect(queue.snapshot().active).toContain('c'))
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('deduplicates the same task id', () => {
    const queue = createTaskExecutionQueue(1)
    const run = () => new Promise<void>(() => undefined)
    queue.enqueue('a', run)
    queue.enqueue('a', run)
    expect(queue.snapshot()).toEqual({ active: ['a'], pending: [] })
  })
})
