import { afterEach, describe, expect, it, vi } from 'vitest'
import { installDesktopFetch, setExtraAllowedHostsProvider } from './desktopFetch'

type Desktop = NonNullable<Window['imageStudioDesktop']>
type DesktopResult = Awaited<ReturnType<NonNullable<Desktop['fetch']>>>
const result: DesktopResult = { status: 200, statusText: 'OK', headers: { 'content-type': 'image/png' }, body: [1, 2] }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function setup(fetch: NonNullable<Desktop['fetch']>, cancelFetch = vi.fn(async (_id: string) => true)) {
  const nativeFetch = vi.fn<typeof window.fetch>(async () => new Response('native'))
  vi.stubGlobal('window', {
    location: { href: 'http://localhost:5173/', origin: 'http://localhost:5173' },
    imageStudioDesktop: { isDesktop: true, platform: 'win32', fetch, cancelFetch },
    fetch: nativeFetch,
  })
  installDesktopFetch()
  return { nativeFetch, cancelFetch }
}

afterEach(() => {
  setExtraAllowedHostsProvider(() => [])
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('desktop fetch cancellation bridge', () => {
  it('does not dispatch an already-aborted request and preserves its reason', async () => {
    const fetch = vi.fn()
    const { cancelFetch } = setup(fetch)
    const controller = new AbortController()
    const reason = new DOMException('Stopped', 'AbortError')
    controller.abort(reason)
    await expect(window.fetch('https://images.example/image', { signal: controller.signal })).rejects.toBe(reason)
    expect(fetch).not.toHaveBeenCalled()
    expect(cancelFetch).not.toHaveBeenCalled()
  })

  it('cancels exactly the dispatched ID and settles before the IPC invocation completes', async () => {
    const pending = deferred<DesktopResult>()
    const fetch = vi.fn<NonNullable<Desktop['fetch']>>(() => pending.promise)
    const { cancelFetch } = setup(fetch)
    const controller = new AbortController()
    const response = window.fetch('https://images.example/image', { signal: controller.signal })
    const rejected = expect(response).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    const payload = fetch.mock.calls[0][0]
    expect(payload.requestId).toEqual(expect.any(String))
    expect(cancelFetch).toHaveBeenCalledExactlyOnceWith(payload.requestId)
    // A late IPC rejection must be observed, not become an unhandled rejection.
    pending.reject(new Error('main finished cancellation'))
    await Promise.resolve()
  })

  it('preserves TimeoutError from a caller deadline and sends the cancel IPC', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn(() => new Promise<DesktopResult>(() => {}))
    const { cancelFetch } = setup(fetch)
    const controller = new AbortController()
    const response = window.fetch('https://images.example/image', { signal: controller.signal })
    const reason = new DOMException('Deadline reached', 'TimeoutError')
    const rejected = expect(response).rejects.toBe(reason)
    setTimeout(() => controller.abort(reason), 25)
    await vi.advanceTimersByTimeAsync(25)
    await rejected
    expect(cancelFetch).toHaveBeenCalledOnce()
  })

  it('stops request-body serialization before dispatch and releases the body reader', async () => {
    const fetch = vi.fn()
    const { cancelFetch } = setup(fetch)
    const cancel = vi.fn()
    const controller = new AbortController()
    const request = new Request('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      body: new ReadableStream({ cancel }),
      signal: controller.signal,
      duplex: 'half',
    } as RequestInit)
    const pending = window.fetch(request)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    await Promise.resolve()
    expect(fetch).not.toHaveBeenCalled()
    expect(cancelFetch).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledOnce()
    expect(request.body?.locked).toBe(false)
  })

  it('removes abort listeners on success and never cancels a completed request', async () => {
    const fetch = vi.fn(async () => result)
    const { cancelFetch } = setup(fetch)
    const controller = new AbortController()
    const request = new Request('https://images.example/image', { signal: controller.signal })
    const remove = vi.spyOn(request.signal, 'removeEventListener')
    const response = await window.fetch(request)
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([1, 2])
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    controller.abort()
    expect(cancelFetch).not.toHaveBeenCalled()
  })

  it('removes listeners on IPC failure and keeps the original abort reason when cancel IPC fails', async () => {
    const controller = new AbortController()
    const request = new Request('https://images.example/image', { signal: controller.signal })
    const remove = vi.spyOn(request.signal, 'removeEventListener')
    const fetch = vi.fn(async () => {
      throw new Error('IPC failed')
    })
    setup(fetch)
    await expect(window.fetch(request)).rejects.toThrow('IPC failed')
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))

    const cancelFetch = vi.fn(async () => {
      throw new Error('window closed')
    })
    setup(() => new Promise<DesktopResult>(() => {}), cancelFetch)
    const reason = new Error('caller stopped')
    const response = window.fetch('https://images.example/image', { signal: controller.signal })
    const rejected = expect(response).rejects.toBe(reason)
    controller.abort(reason)
    await rejected
    await Promise.resolve()
  })

  it('uses distinct IDs for concurrent requests and only cancels the matching request', async () => {
    const first = deferred<DesktopResult>()
    const second = deferred<DesktopResult>()
    const fetch = vi
      .fn<NonNullable<Desktop['fetch']>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const { cancelFetch } = setup(fetch)
    const controller = new AbortController()
    const a = window.fetch('https://images.example/a', { signal: controller.signal })
    const b = window.fetch('https://images.example/b')
    const rejected = expect(a).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    second.resolve(result)
    expect((await b).ok).toBe(true)
    expect(fetch.mock.calls[0][0].requestId).not.toBe(fetch.mock.calls[1][0].requestId)
    expect(cancelFetch).toHaveBeenCalledExactlyOnceWith(fetch.mock.calls[0][0].requestId)
    first.resolve(result)
  })

  it('forwards POST bytes and allowed hosts and supports a null-body response', async () => {
    const fetch = vi.fn<NonNullable<Desktop['fetch']>>(async () => ({
      ...result,
      status: 204,
      statusText: 'No Content',
      body: [],
    }))
    setup(fetch)
    setExtraAllowedHostsProvider(() => ['custom.example'])
    const response = await window.fetch('https://custom.example/v1/images/generations', { method: 'POST', body: 'ok' })
    expect(fetch.mock.calls[0][0]).toMatchObject({ method: 'POST', body: [111, 107], allowedHosts: ['custom.example'] })
    expect(response.status).toBe(204)
    expect(response.body).toBeNull()
  })

  it('leaves same-origin and blob requests on native fetch with their signal', async () => {
    const fetch = vi.fn()
    const { nativeFetch, cancelFetch } = setup(fetch)
    const controller = new AbortController()
    await window.fetch('http://localhost:5173/api-proxy/v1/models', { signal: controller.signal })
    await window.fetch('blob:http://localhost:5173/test', { signal: controller.signal })
    expect(nativeFetch).toHaveBeenCalledTimes(2)
    const request = nativeFetch.mock.calls[0][0] as Request
    controller.abort()
    expect(request.signal.aborted).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
    expect(cancelFetch).not.toHaveBeenCalled()
  })
})
