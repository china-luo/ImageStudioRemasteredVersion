import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildApiUrl,
  LOCAL_DYNAMIC_PROXY_TARGET,
  resolveDevProxyRequestTarget,
  shouldUseApiProxy,
  initializeLocalProxyConfig,
  readClientDevProxyConfig,
  isApiProxyLocked,
  getApiConnectionHint,
} from './devProxy'

describe('local preview proxy discovery', () => {
  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    await initializeLocalProxyConfig()
  })

  it('uses the running preview proxy in a production browser build', async () => {
    vi.stubEnv('DEV', false)
    vi.stubGlobal('window', { location: { hostname: '127.0.0.1', protocol: 'http:' } })
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ enabled: true, target: LOCAL_DYNAMIC_PROXY_TARGET, prefix: '/api-proxy', secure: true }),
            { headers: { 'content-type': 'application/json' } },
          ),
      ),
    )
    await initializeLocalProxyConfig()
    const config = readClientDevProxyConfig()
    expect(config?.enabled).toBe(true)
    expect(isApiProxyLocked(config)).toBe(true)
    expect(
      buildApiUrl(
        'https://planner.example/v1',
        'responses',
        config,
        shouldUseApiProxy(false, config, 'https://planner.example/v1'),
      ),
    ).toBe('/api-proxy/https%3A%2F%2Fplanner.example%2Fv1/responses')
    expect(getApiConnectionHint()).toContain('AI策划中查看 API 代理状态')
  })

  it('does not mistake a static host HTML fallback for a proxy', async () => {
    vi.stubEnv('DEV', false)
    vi.stubGlobal('window', { location: { hostname: 'localhost', protocol: 'http:' } })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>App</html>', { headers: { 'content-type': 'text/html' } })),
    )
    await initializeLocalProxyConfig()
    expect(readClientDevProxyConfig()).toBeNull()
    expect(getApiConnectionHint()).toContain('当前页面未提供 API 代理')
  })

  it('keeps desktop requests on the native transport', async () => {
    vi.stubEnv('DEV', false)
    vi.stubGlobal('window', { imageStudioDesktop: { isDesktop: true } })
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await initializeLocalProxyConfig()
    expect(fetch).not.toHaveBeenCalled()
    expect(getApiConnectionHint()).toContain('内置网络通道')
  })

  it('does not probe remote deployments for a local proxy', async () => {
    vi.stubEnv('DEV', false)
    vi.stubGlobal('window', { location: { hostname: 'studio.example.com', protocol: 'https:' } })
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await initializeLocalProxyConfig()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('buildApiUrl', () => {
  it('uses the same-origin proxy prefix when API proxy is enabled', () => {
    expect(buildApiUrl('http://api.example.com/v1', 'images/edits', null, true)).toBe('/api-proxy/images/edits')
  })

  it('keeps the v1 segment when the configured API URL does not include it', () => {
    expect(buildApiUrl('http://api.example.com', 'images/generations', null, true)).toBe(
      '/api-proxy/v1/images/generations',
    )
  })

  it('includes the current API URL when a local dynamic proxy is available', () => {
    expect(
      buildApiUrl(
        'http://api.example.com/v1',
        'responses',
        {
          enabled: true,
          prefix: '/openai-proxy',
          target: 'http://api.example.com/v1',
          changeOrigin: true,
          secure: false,
        },
        true,
      ),
    ).toBe('/openai-proxy/http%3A%2F%2Fapi.example.com%2Fv1/responses')
  })

  it('uses the configured API URL directly when API proxy is disabled', () => {
    expect(buildApiUrl('http://api.example.com/v1', 'responses', null, false)).toBe(
      'http://api.example.com/v1/responses',
    )
  })

  it('can build Chat Completions URLs without forcing a v1 segment', () => {
    expect(buildApiUrl('https://api.deepseek.com', 'chat/completions', null, false, { prefixV1: false })).toBe(
      'https://api.deepseek.com/chat/completions',
    )
  })
})

describe('resolveDevProxyRequestTarget', () => {
  const proxyConfig = {
    enabled: true,
    prefix: '/api-proxy',
    target: 'http://fallback.example.com/v1',
    changeOrigin: true,
    secure: false,
  }

  it('routes a dynamic proxy request to the API URL supplied by the browser', () => {
    const result = resolveDevProxyRequestTarget(
      '/api-proxy/http%3A%2F%2Fapi.example.com%3A10086%2Fv1/responses?stream=true',
      proxyConfig,
    )

    expect(result?.url.toString()).toBe('http://api.example.com:10086/v1/responses?stream=true')
    expect(result?.dynamic).toBe(true)
  })

  it('keeps compatibility with the previous fixed-target proxy path', () => {
    const result = resolveDevProxyRequestTarget('/api-proxy/images/generations', proxyConfig)

    expect(result?.url.toString()).toBe('http://fallback.example.com/v1/images/generations')
    expect(result?.dynamic).toBe(false)
  })

  it('ignores requests outside the configured proxy prefix', () => {
    expect(resolveDevProxyRequestTarget('/other/responses', proxyConfig)).toBeNull()
  })
})

describe('shouldUseApiProxy', () => {
  const proxyConfig = {
    enabled: true,
    prefix: '/api-proxy',
    target: 'https://api.example.com/v1',
    changeOrigin: true,
    secure: false,
  }

  it('uses the local proxy for a matching profile URL without requiring a stored toggle', () => {
    expect(shouldUseApiProxy(false, proxyConfig, 'https://api.example.com/v1/')).toBe(true)
  })

  it('does not route a different provider through the fixed proxy target', () => {
    expect(shouldUseApiProxy(false, proxyConfig, 'https://other.example.com/v1')).toBe(false)
  })

  it('routes every configured profile through the default local dynamic proxy', () => {
    expect(
      shouldUseApiProxy(false, { ...proxyConfig, target: LOCAL_DYNAMIC_PROXY_TARGET }, 'https://other.example.com/v1'),
    ).toBe(true)
  })
})
