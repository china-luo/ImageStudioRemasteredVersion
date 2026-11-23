const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { createIpcHandlers } = require('./ipcHandlers.cjs')
const { EventEmitter } = require('node:events')
const vm = require('node:vm')

function sender() {
  return Object.assign(new EventEmitter(), { getURL: () => 'file:///app/index.html' })
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

const imageRequest = (requestId = 'test', overrides = {}) => ({
  requestId,
  url: 'https://images.example/image.png',
  ...overrides,
})

function assertSenderClean(contents) {
  for (const name of ['destroyed', 'render-process-gone', 'did-start-navigation']) {
    assert.equal(contents.listenerCount(name), 0)
  }
}

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
    handlers.fetch({ sender: { getURL: () => 'file:///app/index.html' } }, { requestId: 'test', url: 'http://169.254.169.254/latest/meta-data' }),
    /Forbidden/,
  )
  assert.equal(called, false)
})

test('Electron fetch no longer allowlists Shulex hosts or realtime task paths', async () => {
  let called = false
  const handlers = createHandlers(os.tmpdir(), { fetchImpl: async () => { called = true } })
  const event = { sender: sender() }
  await assert.rejects(
    handlers.fetch(event, { requestId: 'retired-host', url: 'https://openapi.shulex.com/v1/responses', method: 'POST' }),
    /Forbidden host/,
  )
  for (const task of ['RtTask01', 'RtQry01']) {
    await assert.rejects(
      handlers.fetch(event, { requestId: task, url: `https://api.openai.com/v1/api/${task}`, method: 'POST' }),
      /Forbidden API path/,
    )
  }
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
    { requestId: 'test', url: 'https://api.openai.com/v1/images/generations', method: 'POST', body: [123] },
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
      { requestId: 'test', url: 'https://api.openai.com/v1/images/generations', method: 'POST' },
    ),
    /Forbidden private address/,
  )
  assert.equal(called, false)
})

test('Electron fetch cancellation during DNS stops before network and cleans sender state', async () => {
  const dnsStarted = deferred()
  const dnsResult = deferred()
  let called = false
  const contents = sender()
  const event = { sender: contents }
  const handlers = createHandlers(os.tmpdir(), {
    lookupHost: () => { dnsStarted.resolve(); return dnsResult.promise },
    fetchImpl: async () => { called = true },
  })
  // An unknown/pre-dispatch cancel must not allocate state or poison future IDs.
  assert.equal(handlers.cancelFetch(event, 'dns'), false)
  const pending = handlers.fetch(event, imageRequest('dns'))
  await dnsStarted.promise
  assert.equal(handlers.cancelFetch(event, 'dns'), true)
  await assert.rejects(pending, { name: 'AbortError' })
  assertSenderClean(contents)
  assert.equal(handlers.cancelFetch(event, 'dns'), false)
  dnsResult.resolve([{ address: '93.184.216.34' }])
  await new Promise(setImmediate)
  assert.equal(called, false)
})

test('Electron cancellation aborts fetch and isolates identical IDs across senders', async () => {
  const a = { sender: sender() }
  const b = { sender: sender() }
  const started = [deferred(), deferred()]
  const signals = []
  const responses = [deferred(), deferred()]
  const handlers = createHandlers(os.tmpdir(), {
    fetchImpl: (_url, options) => {
      const index = signals.push(options.signal) - 1
      started[index].resolve()
      return responses[index].promise
    },
  })
  const first = handlers.fetch(a, imageRequest('shared'))
  const second = handlers.fetch(b, imageRequest('shared'))
  await Promise.all(started.map((item) => item.promise))
  await assert.rejects(handlers.fetch(a, imageRequest('shared')), /Duplicate/)
  assert.equal(handlers.cancelFetch({ sender: sender() }, 'shared'), false)
  assert.equal(handlers.cancelFetch(a, 'shared'), true)
  await assert.rejects(first, { name: 'AbortError' })
  assert.equal(signals[0].aborted, true)
  assert.equal(signals[1].aborted, false)
  responses[0].resolve(new Response('late result'))
  responses[1].resolve(new Response('image'))
  assert.deepEqual((await second).body, [...Buffer.from('image')])
  assert.equal(handlers.cancelFetch(b, 'shared'), false)
  assertSenderClean(a.sender)
  assertSenderClean(b.sender)
})

test('Electron cancellation remains active through response body consumption', async () => {
  const reading = deferred()
  let networkSignal
  const contents = sender()
  const handlers = createHandlers(os.tmpdir(), {
    fetchImpl: async (_url, options) => {
      networkSignal = options.signal
      return {
        status: 200,
        headers: new Headers(),
        arrayBuffer: () => { reading.resolve(); return new Promise(() => {}) },
      }
    },
  })
  const pending = handlers.fetch({ sender: contents }, imageRequest('body'))
  await reading.promise
  handlers.cancelFetch({ sender: contents }, 'body')
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(networkSignal.aborted, true)
  assertSenderClean(contents)
})

test('Electron hard deadline cancels a hung fetch and releases the request ID', async () => {
  const contents = sender()
  let signal
  const handlers = createHandlers(os.tmpdir(), {
    fetchTimeoutMs: 10,
    fetchImpl: (_url, options) => { signal = options.signal; return new Promise(() => {}) },
  })
  // Keep the node test alive while the production deadline timer is unref'ed.
  const keepAlive = setTimeout(() => {}, 1000)
  try {
    await assert.rejects(handlers.fetch({ sender: contents }, imageRequest('timeout')), { name: 'TimeoutError' })
    assert.equal(signal.aborted, true)
    assert.equal(handlers.cancelFetch({ sender: contents }, 'timeout'), false)
    assertSenderClean(contents)
  } finally {
    clearTimeout(keepAlive)
  }
})

for (const lifecycle of ['destroyed', 'render-process-gone', 'did-start-navigation']) {
  test(`Electron ${lifecycle} aborts all pending sender requests without listener accumulation`, async () => {
    const contents = sender()
    const ready = deferred()
    let count = 0
    const handlers = createHandlers(os.tmpdir(), {
      lookupHost: () => {
        if (++count === 12) ready.resolve()
        return new Promise(() => {})
      },
      fetchImpl: () => { throw new Error('must not fetch') },
    })
    const requests = Array.from({ length: 12 }, (_, index) => handlers.fetch({ sender: contents }, imageRequest(`r${index}`)))
    const settled = Promise.all(requests.map((pending) => assert.rejects(pending, { name: 'AbortError' })))
    await ready.promise
    assert.equal(contents.listenerCount(lifecycle), 1)
    contents.emit(lifecycle, {}, 'file:///app/new.html', false, true)
    await settled
    assertSenderClean(contents)
  })
}

test('Electron normal completion and errors remove sender state and allow an ID to be reused', async () => {
  const contents = sender()
  let fail = true
  const handlers = createHandlers(os.tmpdir(), {
    fetchImpl: async () => {
      if (fail) throw new Error('offline')
      return new Response('ok')
    },
  })
  await assert.rejects(handlers.fetch({ sender: contents }, imageRequest()), /offline/)
  assertSenderClean(contents)
  fail = false
  assert.equal((await handlers.fetch({ sender: contents }, imageRequest())).status, 200)
  assertSenderClean(contents)
  await assert.rejects(handlers.fetch({ sender: contents }, imageRequest('', {})), /Invalid/)
  assertSenderClean(contents)
})

test('Electron follows relative image redirects, retaining only safe headers across origins', async () => {
  const calls = []
  const resolutions = []
  let canceledBodies = 0
  const handlers = createHandlers(os.tmpdir(), {
    lookupHost: async (host) => { resolutions.push(host); return [{ address: '93.184.216.34' }] },
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      if (calls.length === 3) return new Response(new Uint8Array([1, 2, 3]))
      return new Response(new ReadableStream({ cancel() { canceledBodies++ } }), {
        status: calls.length === 1 ? 302 : 307,
        headers: { location: calls.length === 1 ? '/next' : 'https://cdn.example/image.png' },
      })
    },
  })
  const result = await handlers.fetch({ sender: sender() }, imageRequest('redirect', {
    headers: { Authorization: 'secret', Cookie: 'cookie', 'X-Api-Key': 'key', 'X-Custom-Secret': 'private', Referer: 'private', Accept: 'image/*', Range: 'bytes=0-' },
  }))
  assert.deepEqual(result.body, [1, 2, 3])
  assert.deepEqual(resolutions, ['images.example', 'images.example', 'cdn.example'])
  assert.equal(calls[1].url, 'https://images.example/next')
  assert.equal(calls[1].options.headers.authorization, 'secret')
  assert.deepEqual(calls[2].options.headers, { accept: 'image/*', range: 'bytes=0-' })
  assert.equal(calls.every(({ options }) => options.redirect === 'manual' && options.credentials === 'omit'), true)
  assert.equal(canceledBodies, 2)
})

for (const status of [301, 302, 303, 307, 308]) {
  test(`Electron never replays an API POST on ${status}`, async () => {
    let calls = 0
    const handlers = createHandlers(os.tmpdir(), {
      fetchImpl: async () => {
        calls++
        return new Response('redirect', { status, headers: { location: 'https://api.openai.com/v1/images/generations' } })
      },
    })
    const result = await handlers.fetch({ sender: sender() }, imageRequest('post', {
      url: 'https://api.openai.com/v1/images/generations', method: 'POST', body: [1],
    }))
    assert.equal(result.status, status)
    assert.equal(calls, 1)
  })
}

for (const target of ['http://127.0.0.1/image', 'file:///image', 'https://user:password@cdn.example/image', 'http://images.example/image']) {
  test(`Electron rejects a redirect outside the permitted URL boundary (${new URL(target).protocol})`, async () => {
    let calls = 0
    const handlers = createHandlers(os.tmpdir(), {
      fetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { location: target } }) },
    })
    await assert.rejects(handlers.fetch({ sender: sender() }, imageRequest()), /Forbidden/)
    assert.equal(calls, 1)
  })
}

test('Electron checks DNS at every hop, including a repeated hostname', async () => {
  let lookups = 0
  let calls = 0
  const handlers = createHandlers(os.tmpdir(), {
    lookupHost: async () => [{ address: ++lookups === 1 ? '93.184.216.34' : '10.0.0.1' }],
    fetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { location: '/next' } }) },
  })
  await assert.rejects(handlers.fetch({ sender: sender() }, imageRequest()), /Forbidden private address/)
  assert.equal(calls, 1)
  assert.equal(lookups, 2)
})

test('Electron rechecks sender origin at the next redirect', async () => {
  const contents = sender()
  let calls = 0
  const handlers = createHandlers(os.tmpdir(), {
    fetchImpl: async () => {
      calls++
      contents.getURL = () => 'https://untrusted.example/'
      return new Response(null, { status: 302, headers: { location: '/next' } })
    },
  })
  await assert.rejects(handlers.fetch({ sender: contents }, imageRequest()), /Forbidden origin/)
  assert.equal(calls, 1)
  assertSenderClean(contents)
})

test('Electron cancellation between redirect hops prevents the next network request', async () => {
  const contents = sender()
  const redirectLookup = deferred()
  let lookups = 0
  let calls = 0
  const handlers = createHandlers(os.tmpdir(), {
    lookupHost: async () => {
      if (++lookups === 1) return [{ address: '93.184.216.34' }]
      redirectLookup.resolve()
      return new Promise(() => {})
    },
    fetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { location: '/next' } }) },
  })
  const pending = handlers.fetch({ sender: contents }, imageRequest())
  await redirectLookup.promise
  handlers.cancelFetch({ sender: contents }, 'test')
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(calls, 1)
  assertSenderClean(contents)
})

test('Electron terminates redirect loops and releases response bodies and sender listeners', async () => {
  let calls = 0
  let canceled = 0
  const contents = sender()
  const handlers = createHandlers(os.tmpdir(), {
    fetchImpl: async () => {
      calls++
      return new Response(new ReadableStream({ cancel() { canceled++ } }), { status: 302, headers: { location: '/loop' } })
    },
  })
  await assert.rejects(handlers.fetch({ sender: contents }, imageRequest()), /Too many.*redirects/)
  assert.equal(calls, 6)
  assert.equal(canceled, 6)
  assertSenderClean(contents)
})

test('Electron preload and main wire request IDs and cancellation over IPC', async () => {
  const registered = new Map()
  const started = deferred()
  let signal
  const handlers = createHandlers(os.tmpdir(), {
    fetchImpl: (_url, options) => { signal = options.signal; started.resolve(); return new Promise(() => {}) },
  })
  const contents = sender()
  const electron = {
    app: { setName() {}, setAppUserModelId() {}, on() {}, whenReady: () => new Promise(() => {}) },
    ipcMain: { handle: (channel, handler) => registered.set(channel, handler) },
    net: { fetch() {} },
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8'), {
    require: (name) => name === 'electron' ? electron : name === './ipcHandlers.cjs' ? { createIpcHandlers: () => handlers } : require(name),
    __dirname,
    process,
  })
  let desktop
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8'), {
    require: () => ({
      contextBridge: { exposeInMainWorld: (_name, value) => { desktop = value } },
      ipcRenderer: { invoke: (channel, payload) => Promise.resolve(registered.get(channel)({ sender: contents }, payload)) },
    }),
    process,
  })
  const pending = desktop.fetch(imageRequest('ipc-round-trip'))
  await started.promise
  assert.equal(await desktop.cancelFetch('ipc-round-trip'), true)
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(signal.aborted, true)
  assertSenderClean(contents)
})

test('Electron secrets handlers persist sanitized records', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-studio-ipc-'))
  try {
    const handlers = createHandlers(directory)
    assert.deepEqual(await handlers.getSecrets(), { apiKey: '', profiles: {} })
    assert.equal(await handlers.setSecrets(null, { apiKey: 'key', vocApiKey: 'voc', profiles: { profile: 'secret' } }), true)
    assert.deepEqual(await handlers.getSecrets(), { apiKey: 'key', profiles: { profile: 'secret' } })
    assert.equal(fs.readFileSync(path.join(directory, 'secrets.bin'), 'utf8').includes('vocApiKey'), false)
    assert.equal(await handlers.setSecrets(null, { apiKey: 42, profiles: [] }), true)
    assert.deepEqual(await handlers.getSecrets(), { apiKey: '', profiles: [] })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('Electron secrets ignore legacy VOC credentials while retaining general profile keys', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-studio-ipc-'))
  try {
    const handlers = createHandlers(directory)
    const legacy = { apiKey: 'image-key', vocApiKey: 'retired-key', profiles: { 'voc-profile': 'retained-profile-key' } }
    fs.writeFileSync(path.join(directory, 'secrets.bin'), JSON.stringify(legacy))
    assert.deepEqual(await handlers.getSecrets(), { apiKey: legacy.apiKey, profiles: legacy.profiles })
    assert.equal(await handlers.setSecrets(null, legacy), true)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'secrets.bin'), 'utf8')), {
      apiKey: legacy.apiKey,
      profiles: legacy.profiles,
    })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('Electron secret reads distinguish an unreadable vault from a missing vault', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-studio-ipc-'))
  try {
    const handlers = createHandlers(directory)
    assert.deepEqual(await handlers.getSecrets(), { apiKey: '', profiles: {} })
    const file = path.join(directory, 'secrets.bin')
    fs.writeFileSync(file, 'not a valid encrypted record')
    await assert.rejects(handlers.getSecrets(), /无法解密已保存的 API 凭据/)
    assert.equal(fs.readFileSync(file, 'utf8'), 'not a valid encrypted record')
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
    assert.deepEqual(await handlers.getSecrets(), { apiKey: '', profiles: {} })
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
