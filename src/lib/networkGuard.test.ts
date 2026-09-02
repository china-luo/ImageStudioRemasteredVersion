import { describe, expect, it } from 'vitest'
import {
  evaluateDesktopFetchRequest,
  evaluateProxyRequest,
  isAllowedProxyApiPath,
  isAllowedProxyHost,
  isBlockedHostname,
} from './networkGuard'

const localOrigin = 'http://localhost:5173'

describe('networkGuard', () => {
  it('rejects private, loopback, and metadata hosts', () => {
    expect(isBlockedHostname('127.0.0.1')).toBe(true)
    expect(isBlockedHostname('10.0.0.8')).toBe(true)
    expect(isBlockedHostname('192.168.1.1')).toBe(true)
    expect(isBlockedHostname('169.254.169.254')).toBe(true)
    expect(isBlockedHostname('localhost')).toBe(true)
    expect(isBlockedHostname('api.openai.com')).toBe(false)
  })

  it('allows default API hosts and extra user-configured hosts', () => {
    expect(isAllowedProxyHost('api.openai.com')).toBe(true)
    expect(isAllowedProxyHost('queue.fal.run')).toBe(true)
    expect(isAllowedProxyHost('custom.example.com')).toBe(false)
    expect(isAllowedProxyHost('custom.example.com', ['custom.example.com'])).toBe(true)
    expect(isAllowedProxyHost('192.168.0.10', ['192.168.0.10'])).toBe(false)
  })

  it('allows known API paths and fal queue paths', () => {
    expect(isAllowedProxyApiPath('/v1/chat/completions')).toBe(true)
    expect(isAllowedProxyApiPath('/v1/images/generations')).toBe(true)
    expect(isAllowedProxyApiPath('/admin')).toBe(false)
    expect(isAllowedProxyApiPath('/openai/gpt-image-2/requests/abc/status', 'queue.fal.run')).toBe(true)
  })

  it('rejects forbidden origins, methods, and private proxy targets', () => {
    expect(
      evaluateProxyRequest({
        origin: 'https://evil.example',
        method: 'POST',
        hostname: 'api.openai.com',
        pathname: '/v1/chat/completions',
        protocol: 'https:',
      }).ok,
    ).toBe(false)

    expect(
      evaluateProxyRequest({
        origin: localOrigin,
        method: 'DELETE',
        hostname: 'api.openai.com',
        pathname: '/v1/chat/completions',
        protocol: 'https:',
      }).error,
    ).toBe('Forbidden method')

    expect(
      evaluateProxyRequest({
        origin: localOrigin,
        method: 'POST',
        hostname: '127.0.0.1',
        pathname: '/v1/chat/completions',
        protocol: 'http:',
      }).error,
    ).toBe('Forbidden private address')
  })

  it('allows a local-origin POST to an allowlisted API path', () => {
    expect(
      evaluateProxyRequest({
        origin: localOrigin,
        method: 'POST',
        hostname: 'api.openai.com',
        pathname: '/v1/chat/completions',
        protocol: 'https:',
      }),
    ).toEqual({ ok: true })
  })

  it('lets desktop GET fetch public image URLs while still blocking private addresses', () => {
    expect(
      evaluateDesktopFetchRequest({
        origin: 'file://',
        method: 'GET',
        hostname: 'v3b.fal.media',
        pathname: '/files/output.png',
        protocol: 'https:',
      }),
    ).toEqual({ ok: true })

    expect(
      evaluateDesktopFetchRequest({
        origin: 'file://',
        method: 'GET',
        hostname: '169.254.169.254',
        pathname: '/latest/meta-data/',
        protocol: 'http:',
      }).error,
    ).toBe('Forbidden private address')

    expect(
      evaluateDesktopFetchRequest({
        origin: 'file://',
        method: 'POST',
        hostname: 'custom.example.com',
        pathname: '/v1/chat/completions',
        protocol: 'https:',
        extraAllowedHosts: ['custom.example.com'],
      }),
    ).toEqual({ ok: true })
  })
})
