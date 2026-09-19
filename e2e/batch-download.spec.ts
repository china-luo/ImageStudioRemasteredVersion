import { expect, test } from '@playwright/test'

const OUTPUT_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLz4QAAAABJRU5ErkJggg=='
const DB_NAME = 'amazon-image-studio'
const STORE_NAMES = ['tasks', 'images', 'thumbnails', 'amazonPlannerSessions']

async function seedGalleryTasks(page: import('@playwright/test').Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/#/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    async ({ outputImage, dbName, storeNames }) => {
      localStorage.removeItem('amazon-image-studio')
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName)
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
    { outputImage: OUTPUT_IMAGE, dbName: DB_NAME, storeNames: STORE_NAMES },
  )
  await page.reload({ waitUntil: 'domcontentloaded' })
}

test('selects multiple gallery tasks and downloads their output images', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  await seedGalleryTasks(page)
  const firstCard = page.locator('[data-task-id="task-e2e-1"]')
  const secondCard = page.locator('[data-task-id="task-e2e-2"]')
  await expect(firstCard).toBeVisible({ timeout: 15_000 })
  await expect(secondCard).toBeVisible({ timeout: 15_000 })
  await expect(firstCard).toHaveCSS('transform', 'none')
  await expect(secondCard).toHaveCSS('transform', 'none')
  await secondCard.scrollIntoViewIfNeeded()
  const firstBox = await firstCard.boundingBox()
  const secondBox = await secondCard.boundingBox()
  expect(firstBox).not.toBeNull()
  expect(secondBox).not.toBeNull()
  const startX = Math.max(1, Math.min(firstBox!.x, secondBox!.x) - 4)
  const startY = Math.max(1, Math.min(firstBox!.y, secondBox!.y) - 4)
  const endX = Math.max(firstBox!.x + firstBox!.width, secondBox!.x + secondBox!.width) + 4
  const endY = Math.max(firstBox!.y + firstBox!.height, secondBox!.y + secondBox!.height) + 4
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(endX, endY, { steps: 10 })
  await page.mouse.up()
  await expect(firstCard.locator('.cursor-pointer').first()).toHaveClass(/ring-2/)
  await expect(secondCard.locator('.cursor-pointer').first()).toHaveClass(/ring-2/)

  await expect(page.getByRole('button', { name: '批量下载' })).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '批量下载' }).click()
  await expect(page.getByText('ZIP 下载成功：2 张图片')).toBeVisible()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^batch-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.zip$/)
})
