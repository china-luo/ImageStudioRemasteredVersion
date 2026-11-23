import { ALLOWED_HOSTS_HEADER } from './networkGuard'

function isDesktopRuntime() {
  return Boolean(window.imageStudioDesktop?.isDesktop && window.imageStudioDesktop.fetch)
}

function shouldUseNativeFetch(url: string) {
  if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return true
  try {
    const parsed = new URL(url, window.location.href)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true
    if (parsed.origin === window.location.origin) return true
  } catch {
    return true
  }
  return false
}

function isSameOriginProxyRequest(url: string) {
  try {
    const parsed = new URL(url, window.location.href)
    return parsed.origin === window.location.origin && parsed.pathname.includes('/api-proxy')
  } catch {
    return false
  }
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {}
  headers.forEach((value, key) => {
    record[key] = value
  })
  return record
}

let extraAllowedHostsProvider: () => string[] = () => []

export function setExtraAllowedHostsProvider(provider: () => string[]) {
  extraAllowedHostsProvider = provider
}

export function getExtraAllowedHosts(): string[] {
  return extraAllowedHostsProvider()
}

function withAllowedHostsHeader(request: Request, extraHosts: string[]): Request {
  if (!extraHosts.length || !isSameOriginProxyRequest(request.url) || request.headers.has(ALLOWED_HOSTS_HEADER)) {
    return request
  }
  const headers = new Headers(request.headers)
  headers.set(ALLOWED_HOSTS_HEADER, extraHosts.join(','))
  return new Request(request, { headers })
}

async function readRequestBody(request: Request): Promise<number[] | undefined> {
  if (request.bodyUsed) throw new TypeError('Request body has already been consumed')
  if (!request.body) return undefined
  const reader = request.body.getReader()
  const onAbort = () => {
    void reader.cancel(request.signal.reason).catch(() => {})
  }
  request.signal.addEventListener('abort', onAbort, { once: true })
  try {
    request.signal.throwIfAborted()
    const chunks: Uint8Array[] = []
    let length = 0
    while (true) {
      const { done, value } = await reader.read()
      request.signal.throwIfAborted()
      if (done) break
      chunks.push(value)
      length += value.length
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    return Array.from(bytes)
  } finally {
    request.signal.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
}

async function fetchViaDesktop(request: Request): Promise<Response> {
  const desktop = window.imageStudioDesktop
  if (!desktop?.fetch) return window.fetch(request)

  const { signal } = request
  signal.throwIfAborted()
  const requestId = crypto.randomUUID()
  let dispatched = false
  let rejectAbort: (reason: unknown) => void = () => {}
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject
  })
  const onAbort = () => {
    // Settle locally even when IPC/network teardown is delayed. The main process
    // registers the ID synchronously before its first await, so a subsequent
    // cancel cannot overtake registration on the same renderer's IPC stream.
    rejectAbort(signal.reason)
    if (dispatched) {
      try {
        void desktop.cancelFetch?.(requestId).catch(() => {})
      } catch {
        // The renderer may be shutting down; its original abort reason wins.
      }
    }
  }
  signal.addEventListener('abort', onAbort, { once: true })

  try {
    const operation = async () => {
      const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await readRequestBody(request)
      // Cancellation while serializing a body must not enqueue a network request.
      signal.throwIfAborted()
      const payload = {
        requestId,
        url: request.url,
        method: request.method,
        headers: headersToRecord(request.headers),
        body,
        allowedHosts: extraAllowedHostsProvider(),
      }
      signal.throwIfAborted()
      dispatched = true
      const result = await desktop.fetch!(payload)
      signal.throwIfAborted()
      return new Response([204, 205, 304].includes(result.status) ? null : new Uint8Array(result.body), {
        status: result.status,
        statusText: result.statusText,
        headers: result.headers,
      })
    }
    return await Promise.race([aborted, operation()])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

export function installDesktopFetch() {
  if ((window.fetch as { __imageStudioGuarded?: boolean }).__imageStudioGuarded) return

  const nativeFetch = window.fetch.bind(window)
  const guardedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request && init == null ? input : new Request(input, init)
    const nextRequest = withAllowedHostsHeader(request, extraAllowedHostsProvider())
    if (isDesktopRuntime() && !shouldUseNativeFetch(nextRequest.url)) {
      return fetchViaDesktop(nextRequest)
    }
    return nativeFetch(nextRequest)
  }) as typeof fetch
  ;(guardedFetch as { __imageStudioGuarded?: boolean }).__imageStudioGuarded = true
  window.fetch = guardedFetch
}
