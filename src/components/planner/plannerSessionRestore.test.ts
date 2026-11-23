import { describe, expect, it, vi } from 'vitest'
import type { AmazonPlannerSession } from '../../types'
import { createPlannerSessionRestorer, mergePlannerSessionHistory } from './plannerSessionRestore'

function session(id: string, updatedAt = 1): AmazonPlannerSession {
  return {
    id,
    updatedAt,
    referenceImageIds: [`${id}-ref`],
    styleImages: [{ candidateIndex: 0, imageId: `${id}-style` }],
  } as AmazonPlannerSession
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

function fixture() {
  const reads = new Map<string, ReturnType<typeof deferred<string | null>>>()
  const commit = vi.fn()
  const setLoading = vi.fn()
  const onError = vi.fn()
  const ensureImageCached = vi.fn((id: string) => {
    const read = deferred<string | null>()
    reads.set(id, read)
    return read.promise
  })
  const restorer = createPlannerSessionRestorer({ ensureImageCached, commit, setLoading, onError })
  return { reads, commit, setLoading, onError, ensureImageCached, restorer }
}

async function finish(f: ReturnType<typeof fixture>, id: string) {
  f.reads.get(`${id}-ref`)!.resolve(`${id}-ref-data`)
  await Promise.resolve()
  f.reads.get(`${id}-style`)!.resolve(`${id}-style-data`)
}

describe('planner history restoration', () => {
  it('commits only the last click when an older read finishes after the newer restore', async () => {
    const f = fixture()
    const old = f.restorer.restore(session('old'))
    const latest = f.restorer.restore(session('latest'))
    await finish(f, 'latest')
    await latest
    f.reads.get('old-ref')!.resolve('old-data')
    await old
    expect(f.commit).toHaveBeenCalledTimes(1)
    expect(f.commit).toHaveBeenCalledWith({
      session: session('latest'),
      references: [{ id: 'latest-ref', dataUrl: 'latest-ref-data' }],
      styleImages: [{ candidateIndex: 0, status: 'done', imageId: 'latest-style', dataUrl: 'latest-style-data' }],
    })
    expect(f.ensureImageCached).not.toHaveBeenCalledWith('old-style')
    expect(f.setLoading.mock.calls).toEqual([[true], [true], [false]])
  })

  it('does not clear the latest loading state when an older request fails', async () => {
    const f = fixture()
    const old = f.restorer.restore(session('old'))
    const latest = f.restorer.restore(session('latest'))
    f.reads.get('old-ref')!.reject(new Error('old failure'))
    await old
    expect(f.onError).not.toHaveBeenCalled()
    expect(f.setLoading.mock.calls).toEqual([[true], [true]])
    await finish(f, 'latest')
    await latest
    expect(f.setLoading).toHaveBeenLastCalledWith(false)
  })

  it.each(['cancel', 'dispose'] as const)(
    'never commits global input or workspace state after %s',
    async (operation) => {
      const f = fixture()
      const pending = f.restorer.restore(session('old'))
      f.restorer[operation]()
      const loadingCalls = f.setLoading.mock.calls.length
      f.reads.get('old-ref')!.resolve('stale-image')
      await pending
      expect(f.commit).not.toHaveBeenCalled()
      expect(f.onError).not.toHaveBeenCalled()
      expect(f.setLoading).toHaveBeenCalledTimes(loadingCalls)
    },
  )

  it('guards cancellation during style image loading as well as reference loading', async () => {
    const f = fixture()
    const pending = f.restorer.restore(session('old'))
    f.reads.get('old-ref')!.resolve('reference')
    await Promise.resolve()
    f.restorer.cancel()
    f.reads.get('old-style')!.resolve('style')
    await pending
    expect(f.commit).not.toHaveBeenCalled()
    expect(f.setLoading).toHaveBeenLastCalledWith(false)
  })

  it('allows restoring after cancellation, skips missing images, and reports only current failures', async () => {
    const f = fixture()
    const old = f.restorer.restore(session('old'))
    f.restorer.cancel()
    const latest = f.restorer.restore(session('latest'))
    f.reads.get('old-ref')!.reject(new Error('ignored'))
    await old
    f.reads.get('latest-ref')!.resolve(null)
    await Promise.resolve()
    f.reads.get('latest-style')!.resolve(null)
    await latest
    expect(f.commit).toHaveBeenCalledWith({ session: session('latest'), references: [], styleImages: [] })
    const failing = f.restorer.restore(session('failure'))
    const error = new Error('storage unavailable')
    f.reads.get('failure-ref')!.reject(error)
    await failing
    expect(f.onError).toHaveBeenCalledExactlyOnceWith(error)
    expect(f.setLoading).toHaveBeenLastCalledWith(false)
  })
})

describe('planner history import refresh', () => {
  it('merges imported rows without losing newly saved local history or overwriting a newer snapshot', () => {
    const local = session('local', 10)
    const edited = session('same', 20)
    const imported = session('imported', 15)
    expect(mergePlannerSessionHistory([local, edited], [session('same', 5), imported])).toEqual([
      edited,
      imported,
      local,
    ])
  })

  it('accepts newer imported snapshots and keeps the local one for equal timestamps', () => {
    const local = session('same', 10)
    const imported = { ...session('same', 20), referenceImageIds: ['imported'] }
    expect(mergePlannerSessionHistory([local], [imported])).toEqual([imported])
    expect(mergePlannerSessionHistory([local], [{ ...local, referenceImageIds: ['stale'] }])).toEqual([local])
  })
})
