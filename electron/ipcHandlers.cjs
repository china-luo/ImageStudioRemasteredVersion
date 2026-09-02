const path = require('node:path')
const { evaluateDesktopFetchRequest, isBlockedIpAddress } = require('./networkGuard.cjs')

function emptySecrets() {
  return { vocApiKey: '', apiKey: '', profiles: {} }
}

function readOriginFromSender(sender) {
  try {
    const senderUrl = new URL(sender.getURL())
    return senderUrl.protocol === 'file:' ? 'file://' : senderUrl.origin
  } catch {
    return 'file://'
  }
}

function createIpcHandlers({ app, fs, safeStorage, fetchImpl = fetch, lookupHost }) {
  const getSecretsPath = () => path.join(app.getPath('userData'), 'secrets.bin')

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
    async fetch(event, payload) {
      const targetUrl = typeof payload?.url === 'string' ? payload.url : ''
      let parsed
      try {
        parsed = new URL(targetUrl)
      } catch {
        throw new Error('Forbidden host')
      }

      const extraAllowedHosts = Array.isArray(payload?.allowedHosts)
        ? payload.allowedHosts.filter((item) => typeof item === 'string')
        : []
      const guard = evaluateDesktopFetchRequest({
        origin: readOriginFromSender(event.sender),
        method: payload?.method,
        hostname: parsed.hostname,
        pathname: parsed.pathname,
        protocol: parsed.protocol,
        extraAllowedHosts,
      })
      if (!guard.ok) {
        const error = new Error(guard.error || 'Forbidden proxy request')
        error.status = guard.status || 403
        throw error
      }

      await assertPublicResolution(parsed.hostname)

      const headers = payload?.headers && typeof payload.headers === 'object' ? payload.headers : {}
      const body = Array.isArray(payload?.body) ? Buffer.from(payload.body) : undefined
      const response = await fetchImpl(parsed.toString(), {
        method: payload?.method || 'GET',
        headers,
        body,
        redirect: 'manual',
      })
      const bytes = new Uint8Array(await response.arrayBuffer())
      return {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: Array.from(bytes),
      }
    },

    async getSecrets() {
      try {
        if (!safeStorage.isEncryptionAvailable()) return emptySecrets()
        const file = getSecretsPath()
        if (!fs.existsSync(file)) return emptySecrets()
        const encrypted = await fs.promises.readFile(file)
        const json = safeStorage.decryptString(encrypted)
        const parsed = JSON.parse(json)
        return {
          vocApiKey: typeof parsed.vocApiKey === 'string' ? parsed.vocApiKey : '',
          apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
          profiles: parsed.profiles && typeof parsed.profiles === 'object' ? parsed.profiles : {},
        }
      } catch {
        return emptySecrets()
      }
    },

    async setSecrets(_event, payload) {
      if (!safeStorage.isEncryptionAvailable()) return false
      const next = {
        vocApiKey: typeof payload?.vocApiKey === 'string' ? payload.vocApiKey : '',
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
