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
  it('preview announces its runtime capability without allowing remote clients', () => {
    const config: DevProxyConfig = {
      enabled: true,
      prefix: '/api-proxy',
      target: LOCAL_DYNAMIC_PROXY_TARGET,
      changeOrigin: true,
      secure: true,
    }
    let middleware: ((request: unknown, response: unknown, next: () => void) => void) | undefined
    const configure = dynamicApiProxyPlugin(config).configurePreviewServer as (server: unknown) => void
    configure({
      middlewares: {
        use(handler: typeof middleware) {
          middleware = handler
        },
      },
    })
    for (const remoteAddress of ['127.0.0.1', '192.168.1.5']) {
      const response = createResponse()
      middleware?.({ url: '/__amazon-image-studio/proxy-config', socket: { remoteAddress } }, response, () => undefined)
      expect(response.statusCode).toBe(remoteAddress === '127.0.0.1' ? 200 : 403)
      if (response.statusCode === 200) {
        expect(JSON.parse(response.body)).toEqual(config)
        expect(response.headers['Cache-Control']).toBe('no-store')
      }
    }
  })
  it.each(['configureServer', 'configurePreviewServer'] as const)(
    '%s rejects private targets before forwarding',
    (hook) => {
      const config: DevProxyConfig = {
        enabled: true,
        prefix: '/api-proxy',
        target: LOCAL_DYNAMIC_PROXY_TARGET,
        changeOrigin: true,
        secure: true,
      }
      let middleware: ((request: unknown, response: unknown, next: () => void) => void) | undefined
      const configureServer = dynamicApiProxyPlugin(config)[hook] as (server: unknown) => void
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
    },
  )
})
