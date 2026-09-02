import { expect, test } from '@playwright/test'

const OUTPUT_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLz4QAAAABJRU5ErkJggg=='
const DB_NAME = 'amazon-image-studio'
const DB_VERSION = 3
const STORE_NAMES = ['tasks', 'images', 'thumbnails', 'amazonPlannerSessions']

async function seedGalleryTasks(page: import('@playwright/test').Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/#/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    async ({ outputImage, dbName, dbVersion, storeNames }) => {
      localStorage.removeItem('amazon-image-studio')
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName, dbVersion)
        request.onupgradeneeded = () => {
          const db = request.result
          for (const storeName of storeNames) {
            if (!db.objectStoreNames.contains(storeName)) {
              db.createObjectStore(storeName, { keyPath: 'id' })
            }
          }
        }
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const transaction = db.transaction(storeNames, 'readwrite')
          for (const storeName of storeNames) transaction.objectStore(storeName).clear()
          const store = transaction.objectStore('tasks')
          for (const id of ['task-e2e-1', 'task-e2e-2']) {
            store.put({
              id,
              prompt: `batch download ${id}`,
              params: {
                size: '1024x1024',
                quality: 'auto',
                output_format: 'png',
                output_compression: 70,
                moderation: 'auto',
                n: 1,
              },
              inputImageIds: [],
              outputImages: [outputImage],
              status: 'done',
              error: null,
              createdAt: id.endsWith('1') ? 1 : 2,
              finishedAt: 2,
              elapsed: 1,
            })
          }
          transaction.oncomplete = () => {
            db.close()
            resolve()
          }
          transaction.onerror = () => reject(transaction.error)
        }
      })
    },
    { outputImage: OUTPUT_IMAGE, dbName: DB_NAME, dbVersion: DB_VERSION, storeNames: STORE_NAMES },
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
}

test('selects multiple gallery tasks and downloads their output images', async ({ page }) => {
  await seedGalleryTasks(page)
  const firstCard = page.locator('[data-task-id="task-e2e-1"]')
  const secondCard = page.locator('[data-task-id="task-e2e-2"]')
  await expect(firstCard).toBeVisible({ timeout: 15_000 })
  await expect(secondCard).toBeVisible({ timeout: 15_000 })
  await expect(firstCard).toHaveCSS('transform', 'none')
  await expect(secondCard).toHaveCSS('transform', 'none')
  await firstCard.click({ modifiers: ['Control'] })
  await secondCard.click({ modifiers: ['Control'] })

  await expect(page.getByRole('button', { name: '批量下载' })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '批量下载' }).click()
  await expect(await download).toBeTruthy()
  await expect(page.getByText('下载成功：2 张图片')).toBeVisible()
})
