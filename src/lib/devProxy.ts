import { readRuntimeEnv } from './runtimeEnv'

export interface DevProxyConfig {
  enabled: boolean
  prefix: string
  target: string
  changeOrigin: boolean
  secure: boolean
}

export interface DevProxyRequestTarget {
  url: URL
  dynamic: boolean
}

const DEFAULT_PROXY_PREFIX = '/api-proxy'
interface BuildApiUrlOptions {
  prefixV1?: boolean
}

function normalizeBaseUrlPreservePath(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed) return ''

  const input = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  try {
    const url = new URL(input)
    const pathname = url.pathname.replace(/\/+$/, '')
    return `${url.origin}${pathname === '/' ? '' : pathname}`
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed) return ''

  const input = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  try {
    const url = new URL(input)
    const pathSegments = url.pathname.split('/').filter(Boolean)
    const v1Index = pathSegments.indexOf('v1')
    const normalizedSegments = v1Index >= 0
      ? pathSegments.slice(0, v1Index + 1)
      : pathSegments.length
        ? [...pathSegments, 'v1']
        : []
    const pathname = normalizedSegments.length ? `/${normalizedSegments.join('/')}` : ''
    return `${url.origin}${pathname}`
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

export function normalizeDevProxyConfig(input: unknown): DevProxyConfig | null {
  if (!input || typeof input !== 'object') return null

  const record = input as Record<string, unknown>
  const target = normalizeBaseUrl(typeof record.target === 'string' ? record.target : '')
  if (!target) return null

  const rawPrefix = typeof record.prefix === 'string' ? record.prefix : DEFAULT_PROXY_PREFIX
  const trimmedPrefix = rawPrefix.trim().replace(/^\/+/, '').replace(/\/+$/, '')
  const prefix = trimmedPrefix ? `/${trimmedPrefix}` : DEFAULT_PROXY_PREFIX

  return {
    enabled: Boolean(record.enabled),
    prefix,
    target,
    changeOrigin: record.changeOrigin !== false,
    secure: Boolean(record.secure),
  }
}

export function buildApiUrl(
  baseUrl: string,
  path: string,
  proxyConfig?: DevProxyConfig | null,
  useApiProxy = false,
  options: BuildApiUrlOptions = {},
): string {
  const prefixV1 = options.prefixV1 !== false
  const normalizedBaseUrl = prefixV1 ? normalizeBaseUrl(baseUrl) : normalizeBaseUrlPreservePath(baseUrl)
  const endpointPath = path.replace(/^\/+/, '')
  const apiPath = prefixV1 && normalizedBaseUrl.endsWith('/v1')
    ? endpointPath
    : prefixV1
      ? ['v1', endpointPath].join('/')
      : endpointPath

  if (useApiProxy) {
    const proxyPrefix = proxyConfig?.prefix ?? DEFAULT_PROXY_PREFIX
    if (proxyConfig?.enabled && normalizedBaseUrl) {
      return `${proxyPrefix}/${encodeURIComponent(normalizedBaseUrl)}/${apiPath}`
    }
    return `${proxyPrefix}/${apiPath}`
  }

  return normalizedBaseUrl ? `${normalizedBaseUrl}/${apiPath}` : `/${apiPath}`
}

export function resolveDevProxyRequestTarget(
  requestUrl: string,
  proxyConfig: DevProxyConfig,
): DevProxyRequestTarget | null {
  const queryIndex = requestUrl.indexOf('?')
  const pathname = queryIndex >= 0 ? requestUrl.slice(0, queryIndex) : requestUrl
  const search = queryIndex >= 0 ? requestUrl.slice(queryIndex) : ''
  const prefix = proxyConfig.prefix

  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return null

  const remainder = pathname.slice(prefix.length).replace(/^\/+/, '')
  const [encodedTarget = '', ...pathSegments] = remainder.split('/')
  let target = proxyConfig.target
  let apiPath = remainder
  let dynamic = false

  try {
    const candidate = new URL(decodeURIComponent(encodedTarget))
    if (candidate.protocol === 'http:' || candidate.protocol === 'https:') {
      target = candidate.toString().replace(/\/+$/, '')
      apiPath = pathSegments.join('/')
      dynamic = true
    }
  } catch {
    // Previous proxy URLs continue to use the configured fallback target.
  }

  const baseUrl = new URL(target.endsWith('/') ? target : `${target}/`)
  return {
    url: new URL(`${apiPath}${search}`, baseUrl),
    dynamic,
  }
}

export function resolveDevProxyConfig(input: unknown, isDev: boolean): DevProxyConfig | null {
  if (!isDev) return null
  return normalizeDevProxyConfig(input)
}

export function readClientDevProxyConfig(): DevProxyConfig | null {
  return resolveDevProxyConfig(
    typeof __DEV_PROXY_CONFIG__ === 'undefined' ? null : __DEV_PROXY_CONFIG__,
    import.meta.env.DEV,
  )
}

export function isApiProxyAvailable(proxyConfig: DevProxyConfig | null = readClientDevProxyConfig()): boolean {
  return readRuntimeEnv(import.meta.env.VITE_API_PROXY_AVAILABLE) === 'true' || Boolean(proxyConfig?.enabled)
}

export function isApiProxyLocked(proxyConfig: DevProxyConfig | null = readClientDevProxyConfig()): boolean {
  return readRuntimeEnv(import.meta.env.VITE_API_PROXY_LOCKED) === 'true' && isApiProxyAvailable(proxyConfig)
}

export function shouldUseApiProxy(apiProxy: boolean, proxyConfig: DevProxyConfig | null = readClientDevProxyConfig()): boolean {
  return isApiProxyAvailable(proxyConfig) && (apiProxy || isApiProxyLocked(proxyConfig))
}
