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

async function fetchViaDesktop(request: Request): Promise<Response> {
  const desktopFetch = window.imageStudioDesktop?.fetch
  if (!desktopFetch) return window.fetch(request)

  const body =
    request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : Array.from(new Uint8Array(await request.clone().arrayBuffer()))

  const result = await desktopFetch({
    url: request.url,
    method: request.method,
    headers: headersToRecord(request.headers),
    body,
    allowedHosts: extraAllowedHostsProvider(),
  })

  return new Response(new Uint8Array(result.body), {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  })
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
