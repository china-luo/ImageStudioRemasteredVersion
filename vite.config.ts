import type { Plugin, ViteDevServer } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import http from 'node:http'
import https from 'node:https'
import {
  type DevProxyConfig,
  LOCAL_DYNAMIC_PROXY_TARGET,
  normalizeDevProxyConfig,
  resolveDevProxyRequestTarget,
} from './src/lib/devProxy'
import { ALLOWED_HOSTS_HEADER, evaluateProxyRequest } from './src/lib/networkGuard'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))
process.env.VITE_APP_VERSION = process.env.VITE_APP_VERSION || pkg.version
const shutdownPath = '/__amazon-image-studio/stop'

function loadDevProxyConfig() {
  try {
    return normalizeDevProxyConfig(JSON.parse(readFileSync('./dev-proxy.config.json', 'utf-8')) as unknown)
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw error
  }
}

function createDefaultLocalProxyConfig() {
  return normalizeDevProxyConfig({
    enabled: true,
    prefix: '/api-proxy',
    target: LOCAL_DYNAMIC_PROXY_TARGET,
    changeOrigin: true,
    secure: true,
  })
}

function isLocalRequest(remoteAddress?: string | null) {
  return remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1'
}

function localShutdownPlugin(): Plugin {
  let server: ViteDevServer | null = null

  return {
    name: 'amazon-image-studio-local-shutdown',
    configureServer(viteServer) {
      server = viteServer
      viteServer.middlewares.use(shutdownPath, (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }))
          return
        }

        if (!isLocalRequest(req.socket.remoteAddress)) {
          res.statusCode = 403
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, error: 'Local requests only' }))
          return
        }

        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: true }))

        setTimeout(() => {
          const httpServer = server?.httpServer
          if (httpServer?.listening) {
            httpServer.close(() => process.exit(0))
            setTimeout(() => process.exit(0), 1000).unref()
          } else {
            process.exit(0)
          }
        }, 100)
      })
    },
  }
}

function writeProxyError(res: http.ServerResponse, status: number, message: string) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ error: { message } }))
}

function readExtraAllowedHosts(req: http.IncomingMessage, configured: string[] = []): string[] {
  const header = req.headers[ALLOWED_HOSTS_HEADER]
  const fromHeader =
    typeof header === 'string'
      ? header.split(',')
      : Array.isArray(header)
        ? header.flatMap((value) => String(value).split(','))
        : []
  return [...configured, ...fromHeader.map((item) => item.trim()).filter(Boolean)]
}

export function dynamicApiProxyPlugin(proxyConfig: DevProxyConfig): Plugin {
  return {
    name: 'amazon-image-studio-dynamic-api-proxy',
    configureServer(viteServer) {
      viteServer.middlewares.use((req, res, next) => {
        const target = resolveDevProxyRequestTarget(req.url ?? '/', proxyConfig)
        if (!target) {
          next()
          return
        }
        if (!isLocalRequest(req.socket.remoteAddress)) {
          writeProxyError(res, 403, 'Local API proxy requests only')
          return
        }
        const guard = evaluateProxyRequest({
          origin: typeof req.headers.origin === 'string' ? req.headers.origin : null,
          method: req.method,
          hostname: target.url.hostname,
          pathname: target.url.pathname,
          protocol: target.url.protocol,
          extraAllowedHosts: readExtraAllowedHosts(req, proxyConfig.allowedHosts),
        })
        if (!guard.ok) {
          writeProxyError(res, guard.status ?? 403, guard.error ?? 'Forbidden proxy request')
          return
        }

        const headers = { ...req.headers }
        if (proxyConfig.changeOrigin) headers.host = target.url.host

        const transport = target.url.protocol === 'https:' ? https : http
        const proxyRequest = transport.request(
          target.url,
          {
            method: req.method,
            headers,
            ...(target.url.protocol === 'https:' ? { rejectUnauthorized: proxyConfig.secure } : {}),
          },
          (proxyResponse) => {
            res.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers)
            proxyResponse.pipe(res)
          },
        )

        proxyRequest.on('error', (error) => {
          if (res.headersSent) {
            res.destroy(error)
            return
          }
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: { message: `API proxy request failed: ${error.message}` } }))
        })
        req.on('aborted', () => proxyRequest.destroy())
        req.pipe(proxyRequest)
      })
    },
  }
}

export default defineConfig(({ command, mode }) => {
  const devProxyConfig =
    command === 'serve' && mode !== 'test' ? (loadDevProxyConfig() ?? createDefaultLocalProxyConfig()) : null

  return {
    plugins: [
      react(),
      ...(command === 'serve' ? [localShutdownPlugin()] : []),
      ...(devProxyConfig?.enabled ? [dynamicApiProxyPlugin(devProxyConfig)] : []),
    ],
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
      __DEV_PROXY_CONFIG__: JSON.stringify(devProxyConfig),
    },
    server: {
      host: true,
    },
    build: {
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/xlsx') || id.includes('node_modules\\xlsx')) return 'xlsx'
            if (id.includes('node_modules/three') || id.includes('node_modules\\three')) return 'three'
          },
        },
      },
    },
    test: {
      include: ['src/**/*.test.ts'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/.worktrees/**'],
      coverage: {
        provider: 'v8',
        include: ['src/lib/**/*.ts'],
        exclude: ['src/lib/**/*.test.ts', 'src/lib/contentEditableMentions.ts'],
        reporter: ['text', 'json-summary'],
        thresholds: {
          lines: 50,
          functions: 45,
          statements: 50,
        },
      },
    },
  }
})
