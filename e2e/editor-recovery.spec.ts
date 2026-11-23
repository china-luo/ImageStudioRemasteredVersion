import { expect, test } from '@playwright/test'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWm0AAAAASUVORK5CYII=',
  'base64',
)
const REFERENCE = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

test('editor draft retains uploaded source and reference images after startup cleanup', async ({ page }) => {
  await page.goto('/#/editor')
  await page
    .locator('input[type=file]:not([multiple])')
    .setInputFiles({ name: 'source.png', mimeType: 'image/png', buffer: PNG })
  const readDraft = () => JSON.parse(localStorage.getItem('amazon-image-studio') ?? '{}').state?.seedreamEditorDraft
  await expect.poll(async () => Boolean((await page.evaluate(readDraft))?.sourceImageId)).toBe(true)
  await page
    .locator('input[type=file][multiple]')
    .setInputFiles({ name: 'reference.gif', mimeType: 'image/gif', buffer: REFERENCE })
  await expect.poll(async () => (await page.evaluate(readDraft))?.referenceImageIds?.length).toBe(1)
  const draft = await page.evaluate(readDraft)
  expect(draft.sourceImageId).toBeTruthy()
  const imageIds = [draft.sourceImageId, draft.referenceImageIds[0]] as string[]
  const orphanId = 'orphan-editor-recovery-regression'
  const readOrSeedImages = async ({ ids, seed }: { ids: string[]; seed?: string }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('amazon-image-studio')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<string[]>((resolve, reject) => {
        const transaction = db.transaction('images', seed ? 'readwrite' : 'readonly')
        const store = transaction.objectStore('images')
        if (seed) store.put({ id: seed, dataUrl: 'data:image/png;base64,AAAA', source: 'upload', createdAt: 1 })
        const requests = ids.map((id) => store.getKey(id))
        transaction.oncomplete = () =>
          resolve(requests.flatMap((request) => (typeof request.result === 'string' ? [request.result] : [])))
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
    } finally {
      db.close()
    }
  }
  expect(await page.evaluate(readOrSeedImages, { ids: imageIds, seed: orphanId })).toEqual(imageIds)
  await page.reload()
  await expect.poll(() => page.evaluate(readOrSeedImages, { ids: [orphanId] })).toEqual([])
  expect(await page.evaluate(readOrSeedImages, { ids: imageIds })).toEqual(imageIds)
})
