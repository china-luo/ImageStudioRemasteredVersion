const PROXY_FORBIDDEN_STATUS = 403

const DEFAULT_PROXY_ALLOWED_HOSTS = [
  'api.openai.com',
  'openrouter.ai',
  'api.deepseek.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'fal.run',
  'fal.ai',
  'queue.fal.run',
  'rest.fal.ai',
  'ark.cn-beijing.volces.com',
  'dashscope.aliyuncs.com',
  'dashscope-intl.aliyuncs.com',
  'dashscope.aliyun.com',
  'dashscope-intl.aliyun.com',
  'aliyuncs.com',
  'aliyun.com',
  'openapi.shulex.com',
]

const ALLOWED_PROXY_METHODS = new Set(['GET', 'POST'])
const FAL_ALLOWED_HOSTS = ['fal.run', 'fal.ai', 'queue.fal.run', 'rest.fal.ai']
const ALLOWED_API_PATH_PATTERNS = [
  /^\/v1\/responses\/?$/,
  /^\/v1\/chat\/completions\/?$/,
  /^\/v1\/images\/(generations|edits|tasks\/[^/]+)\/?$/,
  /^\/v1\/api\/(RtTask01|RtQry01)\/?$/,
  /^\/api\/v1(\/|$)/,
  /^\/api\/v3(\/|$)/,
  /^\/images\/(generations|edits|tasks\/[^/]+)\/?$/,
  /^\/chat\/completions\/?$/,
  /^\/responses\/?$/,
  /^\/openai\//,
  /^\/fal-ai\//,
]
const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)'
const IPV4_PATTERN = new RegExp(`^(?:${IPV4_OCTET}\\.){3}${IPV4_OCTET}$`)

function normalizeHostname(hostname) {
  return String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '')
}

function parseIpv4(hostname) {
  if (!IPV4_PATTERN.test(hostname)) return null
  const parts = hostname.split('.').map(Number)
  if (parts.some((part) => !Number.isInteger(part))) return null
  return parts
}

function isBlockedIpv4(parts) {
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 192 && b === 0 && parts[2] === 0) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a >= 224) return true
  return false
}

function isBlockedIpv6(hostname) {
  const value = hostname.toLowerCase()
  if (value === '::1' || value === '::' || value === '0:0:0:0:0:0:0:1') return true
  if (value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd')) return true
  const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped) {
    const ipv4 = parseIpv4(mapped[1])
    return ipv4 ? isBlockedIpv4(ipv4) : true
  }
  return false
}

function isBlockedIpAddress(address) {
  const hostname = normalizeHostname(address)
  const ipv4 = parseIpv4(hostname)
  if (ipv4) return isBlockedIpv4(ipv4)
  return isBlockedIpv6(hostname)
}

function isBlockedHostname(hostname) {
  const value = normalizeHostname(hostname)
  if (!value) return true
  if (value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local') || value.endsWith('.internal')) return true
  if (value === 'metadata.google.internal' || value.endsWith('.metadata.google.internal')) return true
  return isBlockedIpAddress(value)
}

function isAllowedProxyOrigin(origin) {
  if (!origin) return false
  try {
    const url = new URL(origin)
    if (url.protocol === 'file:') return true
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    const hostname = normalizeHostname(url.hostname)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

function isAllowedProxyMethod(method) {
  return ALLOWED_PROXY_METHODS.has(String(method || 'GET').toUpperCase())
}

function isFalRelatedHost(hostname) {
  if (!hostname) return false
  return hostMatchesAllowlist(hostname, FAL_ALLOWED_HOSTS)
}

function isAllowedProxyApiPath(pathname, hostname) {
  if (!pathname) return false
  const path = String(pathname).split('?')[0]
  if (!path.startsWith('/') || path.includes('..') || path.includes('\\') || path.includes('%2e')) return false
  if (isFalRelatedHost(hostname) && /^\/[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)+\/?$/.test(path)) return true
  return ALLOWED_API_PATH_PATTERNS.some((pattern) => pattern.test(path))
}

function hostMatchesAllowlist(hostname, allowlist) {
  const value = normalizeHostname(hostname)
  return (allowlist || []).some((entry) => {
    const allowed = normalizeHostname(entry)
    if (!allowed) return false
    if (allowed.startsWith('*.')) {
      const suffix = allowed.slice(2)
      return value === suffix || value.endsWith(`.${suffix}`)
    }
    return value === allowed || value.endsWith(`.${allowed}`)
  })
}

function isAllowedProxyHost(hostname, extraAllowedHosts) {
  if (isBlockedHostname(hostname)) return false
  return hostMatchesAllowlist(hostname, [...DEFAULT_PROXY_ALLOWED_HOSTS, ...(extraAllowedHosts || [])])
}

function evaluateProxyRequest(input) {
  if (input.requireOrigin !== false && !isAllowedProxyOrigin(input.origin)) {
    return { ok: false, status: PROXY_FORBIDDEN_STATUS, error: 'Forbidden origin' }
  }
  if (!isAllowedProxyMethod(input.method)) {
    return { ok: false, status: PROXY_FORBIDDEN_STATUS, error: 'Forbidden method' }
  }
  const protocol = String(input.protocol || 'https:').toLowerCase()
  if (protocol !== 'http:' && protocol !== 'https:') {
    return { ok: false, status: PROXY_FORBIDDEN_STATUS, error: 'Forbidden protocol' }
  }
  const hostname = input.hostname || ''
  if (isBlockedHostname(hostname) || isBlockedIpAddress(hostname)) {
    return { ok: false, status: PROXY_FORBIDDEN_STATUS, error: 'Forbidden private address' }
  }
  if (input.requireHostAllowlist !== false && !isAllowedProxyHost(hostname, input.extraAllowedHosts)) {
    return { ok: false, status: PROXY_FORBIDDEN_STATUS, error: 'Forbidden host' }
  }
  if (input.requireApiPath !== false && !isAllowedProxyApiPath(input.pathname, input.hostname)) {
    return { ok: false, status: PROXY_FORBIDDEN_STATUS, error: 'Forbidden API path' }
  }
  return { ok: true }
}

function evaluateDesktopFetchRequest(input) {
  const method = String(input.method || 'GET').toUpperCase()
  const isSafeMethod = method === 'GET'
  return evaluateProxyRequest({
    ...input,
    requireHostAllowlist: isSafeMethod ? false : input.requireHostAllowlist,
    requireApiPath: isSafeMethod ? false : input.requireApiPath,
  })
}

module.exports = {
  PROXY_FORBIDDEN_STATUS,
  DEFAULT_PROXY_ALLOWED_HOSTS,
  evaluateProxyRequest,
  evaluateDesktopFetchRequest,
  isAllowedProxyHost,
  isBlockedHostname,
  isBlockedIpAddress,
}
