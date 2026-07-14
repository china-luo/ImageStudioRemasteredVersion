import { describe, expect, it } from 'vitest'
import { buildApiUrl, resolveDevProxyRequestTarget } from './devProxy'

describe('buildApiUrl', () => {
  it('uses the same-origin proxy prefix when API proxy is enabled', () => {
    expect(buildApiUrl('http://api.example.com/v1', 'images/edits', null, true)).toBe(
      '/api-proxy/images/edits',
    )
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
