import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PROXY_ALLOWED_HOSTS, evaluateDesktopFetchRequest, evaluateProxyRequest } from './networkGuard'

const require = createRequire(import.meta.url)
const electronGuard = require('../../electron/networkGuard.cjs') as {
  DEFAULT_PROXY_ALLOWED_HOSTS: string[]
  evaluateProxyRequest: typeof evaluateProxyRequest
  evaluateDesktopFetchRequest: typeof evaluateDesktopFetchRequest
}

describe('Electron IPC network guard', () => {
  it('keeps the CommonJS main-process guard aligned with the renderer rules', () => {
    expect(electronGuard.DEFAULT_PROXY_ALLOWED_HOSTS).toEqual(DEFAULT_PROXY_ALLOWED_HOSTS)
  })

  it('blocks private POST targets and allows a user-configured API host', () => {
    expect(
      electronGuard.evaluateProxyRequest({
        origin: 'file://',
        method: 'POST',
        hostname: '127.0.0.1',
        pathname: '/v1/chat/completions',
        protocol: 'http:',
      }).error,
    ).toBe('Forbidden private address')

    expect(
      electronGuard.evaluateDesktopFetchRequest({
        origin: 'file://',
        method: 'POST',
        hostname: 'llm.partner.example',
        pathname: '/v1/chat/completions',
        protocol: 'https:',
        extraAllowedHosts: ['llm.partner.example'],
      }),
    ).toEqual({ ok: true })
  })
})
