const path = require('node:path')
const { evaluateDesktopFetchRequest, isBlockedIpAddress } = require('./networkGuard.cjs')

function emptySecrets() {
  return { apiKey: '', profiles: {} }
}

function readOriginFromSender(sender) {
  try {
    const senderUrl = new URL(sender.getURL())
    return senderUrl.protocol === 'file:' ? 'file://' : senderUrl.origin
  } catch {
    return 'file://'
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 5
const CROSS_ORIGIN_HEADERS = new Set(['accept', 'accept-language', 'range'])

// Race non-cancellable work (notably DNS) as well as body reads against abort.
// The actual fetch still receives the signal so the network is also torn down.
function abortable(operation, signal) {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(signal.reason)
    }
    const finish = (settle, value) => {
      signal.removeEventListener('abort', onAbort)
      settle(value)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve().then(() => {
      signal.throwIfAborted()
      return operation()
    }).then((value) => finish(resolve, value), (error) => finish(reject, error))
  })
}

function createIpcHandlers({ app, fs, safeStorage, fetchImpl = fetch, lookupHost, fetchTimeoutMs = 10 * 60_000 }) {
  const getSecretsPath = () => path.join(app.getPath('userData'), 'secrets.bin')
  // Use WebContents identity, not renderer-supplied IDs or recyclable numeric IDs.
  const senderRequests = new WeakMap()

  const requestsFor = (sender) => {
    let state = senderRequests.get(sender)
    if (state) return state
    const requests = new Map()
    const abortAll = () => {
      for (const controller of requests.values()) controller.abort()
    }
    const onNavigate = (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) abortAll()
    }
    sender.on?.('destroyed', abortAll)
    sender.on?.('render-process-gone', abortAll)
    sender.on?.('did-start-navigation', onNavigate)
    state = {
      requests,
      dispose() {
        sender.removeListener?.('destroyed', abortAll)
        sender.removeListener?.('render-process-gone', abortAll)
        sender.removeListener?.('did-start-navigation', onNavigate)
        senderRequests.delete(sender)
      },
    }
    senderRequests.set(sender, state)
    return state
  }

  const assertPublicResolution = async (hostname) => {
    if (!lookupHost) return
    const resolved = await lookupHost(hostname)
    const addresses = Array.isArray(resolved) ? resolved : [resolved]
    if (!addresses.length || addresses.some((item) => !item || isBlockedIpAddress(item.address))) {
      const error = new Error('Forbidden private address')
      error.status = 403
      throw error
    }
  }

  return {
    cancelFetch(event, requestId) {
      const controller = senderRequests.get(event.sender)?.requests.get(requestId)
      if (!controller) return false
      controller.abort()
      return true
    },

    async fetch(event, payload) {
      const requestId = payload?.requestId
      if (typeof requestId !== 'string' || !/^[\w:-]{1,128}$/.test(requestId)) {
        throw new Error('Invalid desktop fetch request ID')
      }
      const state = requestsFor(event.sender)
      if (state.requests.has(requestId)) throw new Error('Duplicate desktop fetch request ID')
      const controller = new AbortController()
      const { signal } = controller
      // Register before any asynchronous work. Unknown/late cancels are no-ops,
      // never tombstones that could cancel a future unrelated request.
      state.requests.set(requestId, controller)
      const timer = setTimeout(() => {
        controller.abort(new DOMException('Desktop fetch timed out', 'TimeoutError'))
      }, fetchTimeoutMs)
      timer.unref?.()

      try {
        if (event.sender.isDestroyed?.()) controller.abort()
        signal.throwIfAborted()
        let parsed
        try {
          parsed = new URL(typeof payload?.url === 'string' ? payload.url : '')
        } catch {
          throw new Error('Forbidden host')
        }
        const method = String(payload?.method || 'GET').toUpperCase()
        const extraAllowedHosts = Array.isArray(payload?.allowedHosts)
          ? payload.allowedHosts.filter((item) => typeof item === 'string')
          : []
        let headers = new Headers(payload?.headers && typeof payload.headers === 'object' ? payload.headers : {})
        const body = Array.isArray(payload?.body) ? Buffer.from(payload.body) : undefined

        for (let redirects = 0; ; redirects++) {
          signal.throwIfAborted()
          const guard = evaluateDesktopFetchRequest({
            origin: readOriginFromSender(event.sender),
            method,
            hostname: parsed.hostname,
            pathname: parsed.pathname,
            protocol: parsed.protocol,
            extraAllowedHosts,
          })
          if (!guard.ok || parsed.username || parsed.password) {
            const error = new Error(guard.error || 'Forbidden URL credentials')
            error.status = guard.status || 403
            throw error
          }
          await abortable(() => assertPublicResolution(parsed.hostname), signal)
          const response = await abortable(() => fetchImpl(parsed.toString(), {
            method,
            headers: Object.fromEntries(headers.entries()),
            body,
            redirect: 'manual',
            // Do not let the Electron session silently attach cookies, including
            // cookies for an unrelated origin reached by a public image redirect.
            credentials: 'omit',
            signal,
          }), signal)
          const location = response.headers.get('location')
          // API POSTs are never replayed or silently converted to GET, even on 303.
          if (method === 'GET' && REDIRECT_STATUSES.has(response.status) && location) {
            await abortable(() => response.body?.cancel(), signal)
            if (redirects >= MAX_REDIRECTS) throw new Error('Too many desktop fetch redirects')
            const next = new URL(location, parsed)
            if (parsed.protocol === 'https:' && next.protocol === 'http:') {
              throw new Error('Forbidden HTTPS redirect downgrade')
            }
            if (next.origin !== parsed.origin) {
              // An allowlist also strips unknown custom API-key/credential headers.
              headers = new Headers([...headers].filter(([name]) => CROSS_ORIGIN_HEADERS.has(name)))
            }
            parsed = next
            continue
          }
          const bytes = new Uint8Array(await abortable(() => response.arrayBuffer(), signal))
          signal.throwIfAborted()
          return {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body: Array.from(bytes),
          }
        }
      } finally {
        clearTimeout(timer)
        state.requests.delete(requestId)
        if (!state.requests.size) state.dispose()
      }
    },

    async getSecrets() {
      if (!safeStorage.isEncryptionAvailable()) return emptySecrets()
      let encrypted
      try {
        encrypted = await fs.promises.readFile(getSecretsPath())
      } catch (error) {
        if (error?.code === 'ENOENT') return emptySecrets()
        throw new Error('无法读取加密凭据文件')
      }
      try {
        const parsed = JSON.parse(safeStorage.decryptString(encrypted))
        return {
          apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
          profiles: parsed.profiles && typeof parsed.profiles === 'object' ? parsed.profiles : {},
        }
      } catch {
        throw new Error('无法解密已保存的 API 凭据')
      }
    },

    async setSecrets(_event, payload) {
      if (!safeStorage.isEncryptionAvailable()) return false
      const next = {
        apiKey: typeof payload?.apiKey === 'string' ? payload.apiKey : '',
        profiles: payload?.profiles && typeof payload.profiles === 'object' ? payload.profiles : {},
      }
      const json = JSON.stringify(next)
      const data = safeStorage.encryptString(json)
      await fs.promises.writeFile(getSecretsPath(), data)
      return true
    },
  }
}

module.exports = { createIpcHandlers, emptySecrets, readOriginFromSender }
