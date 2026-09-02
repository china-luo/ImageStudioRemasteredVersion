import { describe, expect, it } from 'vitest'
import { dynamicApiProxyPlugin } from '../../vite.config'
import { LOCAL_DYNAMIC_PROXY_TARGET, type DevProxyConfig } from './devProxy'

type ResponseCapture = {
  statusCode: number
  body: string
  headers: Record<string, string>
  setHeader: (name: string, value: string) => void
  end: (body: string) => void
}

function createResponse(): ResponseCapture {
  return {
    statusCode: 200,
    body: '',
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(body) {
      this.body = body
    },
  }
}

describe('Vite dynamic proxy integration', () => {
  it('returns 403 for a private dynamic proxy target before forwarding', () => {
    const config: DevProxyConfig = {
      enabled: true,
      prefix: '/api-proxy',
      target: LOCAL_DYNAMIC_PROXY_TARGET,
      changeOrigin: true,
      secure: true,
    }
    let middleware: ((request: unknown, response: unknown, next: () => void) => void) | undefined
    const configureServer = dynamicApiProxyPlugin(config).configureServer as (server: unknown) => void
    configureServer({
      middlewares: {
        use(handler: typeof middleware) {
          middleware = handler
        },
      },
    } as never)

    const response = createResponse()
    middleware?.(
      {
        url: `/api-proxy/${encodeURIComponent('http://169.254.169.254')}/latest/meta-data`,
        method: 'GET',
        headers: { origin: 'http://127.0.0.1:5173' },
        socket: { remoteAddress: '127.0.0.1' },
      },
      response,
      () => undefined,
    )

    expect(response.statusCode).toBe(403)
    expect(response.body).toContain('Forbidden private address')
  })
})
