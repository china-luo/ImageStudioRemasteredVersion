import { expect, test, type Page } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'

let server: ViteDevServer
let origin: string

// A test-owned origin permits importing the real database module without adding production test hooks.
// Playwright creates a fresh, non-persistent browser context for every test; no user profile is opened.
test.beforeAll(async () => {
  server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false } })
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server address')
  origin = `http://127.0.0.1:${address.port}`
})
test.afterAll(async () => {
  await server?.close()
})

async function loadDb(page: Page) {
  await page.goto(`${origin}/manifest.webmanifest`)
  await page.evaluate(async () => {
    const db = await new Function('return import("/src/lib/db.ts")')()
    ;(window as any).taskDb = db
    await db.getAllTasks()
  })
}

async function rows(page: Page) {
  return page.evaluate(async () => {
    const db = (window as any).taskDb
    return {
      tasks: await db.getAllTasks(),
      images: await db.getAllImages(),
      projects: await db.getAllGenerationProjects(),
      sessions: await db.getAllAmazonPlannerSessions(),
    }
  })
}

test('delayed notifications cannot let a stale tab recreate cleared task-backed stores', async ({ page, context }) => {
  const peer = await context.newPage()
  await loadDb(page)
  await page.evaluate(async () => {
    const db = (window as any).taskDb
    await db.importTaskData({
      tasks: [{ id: 'old-task' }],
      images: [{ id: 'old-image', dataUrl: 'old' }],
      thumbnails: [{ id: 'old-image', thumbnailDataUrl: 'old' }],
      projects: [{ id: 'old-project' }],
      plannerSessions: [{ id: 'old-session' }],
    })
  })
  await loadDb(peer)
  // Intentionally do not subscribe in the peer: signals cannot help this write.
  // Also suspend image hashing, representing work already started before the clear.
  await peer.evaluate(() => {
    const state = window as any
    const digest = crypto.subtle.digest.bind(crypto.subtle)
    crypto.subtle.digest = async (...args) => {
      await new Promise<void>((resolve) => {
        state.releaseHash = resolve
      })
      return digest(...args)
    }
    state.pendingImage = state.taskDb.storeImage('data:image/png;base64,AA==').then(
      () => 'unexpected-write',
      (error: DOMException) => error.name,
    )
  })
  await page.evaluate(async () => {
    // HTTP LAN origins expose getRandomValues but may not expose randomUUID.
    const uuid = crypto.randomUUID
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined })
    try {
      await (window as any).taskDb.clearTaskData()
    } finally {
      Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: uuid })
    }
  })
  const failures = await peer.evaluate(async () => {
    const db = (window as any).taskDb
    const operations = [
      () => db.putTask({ id: 'stale-task' }),
      () => db.putImage({ id: 'stale-image', dataUrl: 'old' }),
      () => db.putImageThumbnail({ id: 'stale-image', thumbnailDataUrl: 'old' }),
      () => db.putAmazonPlannerSession({ id: 'stale-session' }),
      () => db.putGenerationProject({ id: 'stale-project' }, 0),
      () =>
        db.importTaskData({
          tasks: [{ id: 'stale-import' }],
          images: [],
          thumbnails: [],
          projects: [],
          plannerSessions: [],
        }),
      () => db.deleteImage('old-image'),
      () => db.clearImages(),
    ]
    return Promise.all(
      operations.map(async (operation) => {
        try {
          await operation()
          return 'unexpected-write'
        } catch (error) {
          return (error as DOMException).name
        }
      }),
    )
  })
  expect(failures).toEqual(Array(8).fill('AbortError'))
  expect(
    await peer.evaluate(async () => {
      const state = window as any
      state.releaseHash()
      return state.pendingImage
    }),
  ).toBe('AbortError')
  expect(await rows(page)).toEqual({ tasks: [], images: [], projects: [], sessions: [] })
  expect(
    await page.evaluate(async () => {
      const request = indexedDB.open('amazon-image-studio')
      return new Promise((resolve, reject) => {
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('thumbnails')
          const read = tx.objectStore('thumbnails').getAll()
          tx.oncomplete = () => {
            db.close()
            resolve(read.result)
          }
          tx.onabort = () => {
            db.close()
            reject(tx.error)
          }
        }
      })
    }),
  ).toEqual([])
})

test('peer resets before accepting the new epoch, then permits genuinely new writes', async ({ page, context }) => {
  const peer = await context.newPage()
  await loadDb(page)
  await loadDb(peer)
  await peer.evaluate(() => {
    const state = window as any
    state.resetStarted = false
    state.taskDb.subscribeTaskDataReset(async () => {
      state.resetStarted = true
      await new Promise<void>((resolve) => {
        state.finishReset = resolve
      })
      return () => {
        state.afterAcceptRead = state.taskDb.getAllTasks()
      }
    })
  })
  await page.evaluate(() => (window as any).taskDb.clearTaskData())
  await expect.poll(() => peer.evaluate(() => (window as any).resetStarted)).toBe(true)
  expect(
    await peer.evaluate(async () => {
      try {
        await (window as any).taskDb.putTask({ id: 'too-early' })
        return 'unexpected-write'
      } catch (error) {
        return (error as DOMException).name
      }
    }),
  ).toBe('AbortError')
  await peer.evaluate(async () => {
    const state = window as any
    state.finishReset()
    await state.taskDb.refreshTaskDataEpoch()
    await state.afterAcceptRead
    await state.taskDb.putTask({ id: 'new-task' })
    await state.taskDb.putGenerationProject({ id: 'new-project' }, 0)
  })
  expect(await peer.evaluate(() => (window as any).afterAcceptRead)).toEqual([])
  expect(await rows(page)).toMatchObject({
    tasks: [{ id: 'new-task' }],
    projects: [{ id: 'new-project', revision: 1 }],
  })
})

test('an aborted clear rolls back its epoch as well as data and does not invalidate peers', async ({
  page,
  context,
}) => {
  const peer = await context.newPage()
  await loadDb(page)
  await page.evaluate(() => (window as any).taskDb.putTask({ id: 'preserved' }))
  await loadDb(peer)
  await peer.evaluate(() => {
    const state = window as any
    state.resets = 0
    state.taskDb.subscribeTaskDataReset(() => {
      state.resets++
    })
  })
  expect(
    await page.evaluate(async () => {
      const clear = IDBObjectStore.prototype.clear
      IDBObjectStore.prototype.clear = function () {
        const request = clear.call(this)
        if (this.name === 'images') request.onsuccess = () => this.transaction.abort()
        return request
      }
      try {
        await (window as any).taskDb.clearTaskData()
        return 'unexpected-success'
      } catch {
        return 'aborted'
      } finally {
        IDBObjectStore.prototype.clear = clear
      }
    }),
  ).toBe('aborted')
  await peer.evaluate(async () => {
    const state = window as any
    await state.taskDb.refreshTaskDataEpoch()
    await state.taskDb.putTask({ id: 'peer-still-valid' })
  })
  expect(await peer.evaluate(() => (window as any).resets)).toBe(0)
  expect((await rows(page)).tasks.map((task: any) => task.id).sort()).toEqual(['peer-still-valid', 'preserved'])
})

test('a failed reset keeps the fence closed until a successful retry', async ({ page, context }) => {
  const peer = await context.newPage()
  await loadDb(page)
  await loadDb(peer)
  await peer.evaluate(() => {
    const state = window as any
    state.allowReset = false
    state.resetCalls = 0
    state.taskDb.subscribeTaskDataReset(() => {
      state.resetCalls++
      if (!state.allowReset) throw new Error('simulated reset failure')
    })
  })
  await page.evaluate(() => (window as any).taskDb.clearTaskData())
  await expect.poll(() => peer.evaluate(() => (window as any).resetCalls)).toBeGreaterThan(0)
  expect(
    await peer.evaluate(async () => {
      try {
        await (window as any).taskDb.putTask({ id: 'must-stay-rejected' })
        return 'unexpected-write'
      } catch (error) {
        return (error as DOMException).name
      }
    }),
  ).toBe('AbortError')
  await peer.evaluate(async () => {
    const state = window as any
    await state.taskDb.refreshTaskDataEpoch().catch(() => {})
    state.allowReset = true
    await state.taskDb.refreshTaskDataEpoch()
    await state.taskDb.putTask({ id: 'after-successful-retry' })
  })
  expect((await rows(page)).tasks).toEqual([{ id: 'after-successful-retry' }])
})

test('another clear during reset accepts only the final epoch and discards obsolete callbacks', async ({
  page,
  context,
}) => {
  const peer = await context.newPage()
  await loadDb(page)
  await loadDb(peer)
  await peer.evaluate(() => {
    const state = window as any
    state.resetCalls = 0
    state.acceptedCallbacks = 0
    state.taskDb.subscribeTaskDataReset(async () => {
      const call = ++state.resetCalls
      await new Promise<void>((resolve) => {
        state[`finishReset${call}`] = resolve
      })
      return () => {
        state.acceptedCallbacks++
      }
    })
  })
  await page.evaluate(() => (window as any).taskDb.clearTaskData())
  await expect.poll(() => peer.evaluate(() => (window as any).resetCalls)).toBe(1)
  await page.evaluate(() => (window as any).taskDb.clearTaskData())
  await peer.evaluate(() => (window as any).finishReset1())
  await expect.poll(() => peer.evaluate(() => (window as any).resetCalls)).toBe(2)
  expect(await peer.evaluate(() => (window as any).acceptedCallbacks)).toBe(0)
  await peer.evaluate(async () => {
    const state = window as any
    state.finishReset2()
    await state.taskDb.refreshTaskDataEpoch()
    await state.taskDb.putTask({ id: 'final-epoch-task' })
    await state.taskDb.refreshTaskDataEpoch()
  })
  expect(await peer.evaluate(() => (window as any).acceptedCallbacks)).toBe(1)
  expect(await peer.evaluate(() => (window as any).resetCalls)).toBe(2)
  expect((await rows(page)).tasks).toEqual([{ id: 'final-epoch-task' }])
})

test('clearing in one application tab cancels peer state and persisted editor references', async ({
  page,
  context,
}) => {
  await page.goto(`${origin}/#/editor`)
  const peer = await context.newPage()
  await peer.goto(`${origin}/#/editor`)
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWm0AAAAASUVORK5CYII=',
    'base64',
  )
  await peer
    .locator('input[type=file]:not([multiple])')
    .setInputFiles({ name: 'source.png', mimeType: 'image/png', buffer: image })
  const peerDraft = () =>
    peer.evaluate(async () => {
      const { useStore } = await new Function('return import("/src/store.ts")')()
      return useStore.getState().seedreamEditorDraft
    })
  await expect.poll(async () => (await peerDraft()).sourceImageId).toBeTruthy()
  await page.getByRole('banner').getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '数据管理', exact: true }).click()
  await page.getByRole('button', { name: '清空所选数据', exact: true }).click()
  await page.getByRole('button', { name: '确认清空', exact: true }).click()
  await expect(page.getByText('所选数据已清空')).toBeVisible()
  await expect
    .poll(peerDraft)
    .toMatchObject({ sourceImageId: null, referenceImageIds: [], instruction: '', latestTaskId: null })
  await expect
    .poll(() =>
      peer.evaluate(() => JSON.parse(localStorage.getItem('amazon-image-studio') ?? '{}').state?.seedreamEditorDraft),
    )
    .toMatchObject({ sourceImageId: null, referenceImageIds: [] })
  await peer.reload()
  await expect.poll(peerDraft).toMatchObject({ sourceImageId: null, referenceImageIds: [] })
})
