import { expect, test } from '@playwright/test'

const OUTPUT_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLz4QAAAABJRU5ErkJggg=='

async function seedGalleryTasks(page: import('@playwright/test').Page) {
  await page.goto('/#/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    async ({ outputImage }) => {
      localStorage.removeItem('amazon-image-studio')
      await new Promise<void>((resolve, reject) => {
        const deletion = indexedDB.deleteDatabase('amazon-image-studio')
        deletion.onsuccess = () => resolve()
        deletion.onerror = () => reject(deletion.error)
        deletion.onblocked = () => resolve()
      })
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('amazon-image-studio', 3)
        request.onupgradeneeded = () => {
          request.result.createObjectStore('tasks', { keyPath: 'id' })
          request.result.createObjectStore('images', { keyPath: 'id' })
          request.result.createObjectStore('thumbnails', { keyPath: 'id' })
          request.result.createObjectStore('amazonPlannerSessions', { keyPath: 'id' })
        }
        request.onsuccess = () => {
          const db = request.result
          const transaction = db.transaction('tasks', 'readwrite')
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
        request.onerror = () => reject(request.error)
      })
    },
    { outputImage: OUTPUT_IMAGE },
  )
  await page.reload()
}

test('selects multiple gallery tasks and downloads their output images', async ({ page }) => {
  await seedGalleryTasks(page)
  await expect(page.locator('[data-task-id="task-e2e-1"]')).toBeVisible({ timeout: 15_000 })
  await page.locator('[data-task-id="task-e2e-1"]').click({ modifiers: ['Control'] })
  await page.locator('[data-task-id="task-e2e-2"]').click({ modifiers: ['Control'] })

  await expect(page.getByRole('button', { name: '批量下载' })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '批量下载' }).click()
  await expect(await download).toBeTruthy()
  await expect(page.getByText('下载成功：2 张图片')).toBeVisible()
})
