const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { createIpcHandlers } = require('./ipcHandlers.cjs')

function createHandlers(directory, overrides = {}) {
  return createIpcHandlers({
    app: { getPath: () => directory },
    fs,
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString('utf8'),
    },
    lookupHost: async () => [{ address: '93.184.216.34', family: 4 }],
    ...overrides,
  })
}

test('Electron fetch handler rejects a disallowed target before network access', async () => {
  let called = false
  const handlers = createHandlers(os.tmpdir(), { fetchImpl: async () => { called = true } })
  await assert.rejects(
    handlers.fetch({ sender: { getURL: () => 'file:///app/index.html' } }, { url: 'http://169.254.169.254/latest/meta-data' }),
    /Forbidden/,
  )
  assert.equal(called, false)
})

test('Electron fetch handler forwards approved image requests', async () => {
  const handlers = createHandlers(os.tmpdir(), {
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/images/generations')
      assert.equal(options.method, 'POST')
      assert.equal(options.redirect, 'manual')
      return new Response(new Uint8Array([1, 2]), { status: 201, statusText: 'Created', headers: { 'x-test': 'ok' } })
    },
  })
  const result = await handlers.fetch(
    { sender: { getURL: () => 'file:///app/index.html' } },
    { url: 'https://api.openai.com/v1/images/generations', method: 'POST', body: [123] },
  )
  assert.deepEqual(result.body, [1, 2])
  assert.equal(result.status, 201)
  assert.equal(result.headers['x-test'], 'ok')
})

test('Electron fetch handler rejects a hostname that resolves to a private address', async () => {
  let called = false
  const handlers = createHandlers(os.tmpdir(), {
    lookupHost: async () => [{ address: '127.0.0.1', family: 4 }],
    fetchImpl: async () => {
      called = true
    },
  })
  await assert.rejects(
    handlers.fetch(
      { sender: { getURL: () => 'file:///app/index.html' } },
      { url: 'https://api.openai.com/v1/images/generations', method: 'POST' },
    ),
    /Forbidden private address/,
  )
  assert.equal(called, false)
})

test('Electron secrets handlers persist sanitized records', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-studio-ipc-'))
  try {
    const handlers = createHandlers(directory)
    assert.deepEqual(await handlers.getSecrets(), { vocApiKey: '', apiKey: '', profiles: {} })
    assert.equal(await handlers.setSecrets(null, { apiKey: 'key', vocApiKey: 'voc', profiles: { profile: 'secret' } }), true)
    assert.deepEqual(await handlers.getSecrets(), { apiKey: 'key', vocApiKey: 'voc', profiles: { profile: 'secret' } })
    assert.equal(await handlers.setSecrets(null, { apiKey: 42, profiles: [] }), true)
    assert.deepEqual(await handlers.getSecrets(), { apiKey: '', vocApiKey: '', profiles: [] })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('Electron secrets handlers do not persist plaintext when encryption is unavailable', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-studio-ipc-'))
  try {
    const handlers = createHandlers(directory, {
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: () => {
          throw new Error('must not encrypt')
        },
        decryptString: () => {
          throw new Error('must not decrypt')
        },
      },
    })
    assert.equal(await handlers.setSecrets(null, { apiKey: 'plaintext-secret' }), false)
    assert.equal(fs.existsSync(path.join(directory, 'secrets.bin')), false)
    assert.deepEqual(await handlers.getSecrets(), { vocApiKey: '', apiKey: '', profiles: {} })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
