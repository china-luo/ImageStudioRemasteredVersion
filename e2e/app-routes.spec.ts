import { expect, test } from '@playwright/test'

test('opens SOP, VOC, and editor from URL hashes', async ({ page }) => {
  await page.goto('/#/sop', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '电商图片拆解反推 SOP' })).toBeVisible({ timeout: 15_000 })

  await page.goto('/#/voc', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Amazon VOC 评论分析' })).toBeVisible()

  await page.goto('/#/editor', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '图片编辑' })).toBeVisible()
})

test('shows a read-only planner product summary without a separate extraction action', async ({ page }) => {
  await page.goto('/#/', { waitUntil: 'domcontentloaded' })

  const summary = page.getByRole('region', { name: 'AI 商品信息摘要' })
  await expect(summary).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: '提取信息', exact: true })).toHaveCount(0)
  await expect(summary.getByText('涉及工作流逻辑', { exact: true })).toBeVisible()
  await expect(summary.getByText('仅展示与历史保存', { exact: true })).toBeVisible()

  const fields = summary.locator('input, textarea')
  await expect(fields).toHaveCount(8)
  expect(
    await fields.evaluateAll((elements) => elements.every((element) => (element as HTMLInputElement).readOnly)),
  ).toBe(true)

  const productTitleNote = summary.getByText(
    '用于策划历史名称、生成任务归类和同一商品任务匹配；不会单独追加到生图提示词。',
    { exact: true },
  )
  await expect(productTitleNote).not.toBeVisible()
  await summary.getByRole('button', { name: '查看商品标题字段说明' }).click()
  await expect(productTitleNote).toBeVisible()
  await expect(summary.locator('textarea')).toHaveCount(2)
  expect(await summary.locator('textarea').evaluateAll((elements) => elements.map((element) => element.rows))).toEqual([
    1, 1,
  ])
})

test('clears legacy planner sessions during the database v4 upgrade', async ({ page }) => {
  await page.goto('/manifest.webmanifest', { waitUntil: 'domcontentloaded' })
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('amazon-image-studio')
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('amazon-image-studio', 3)
      request.onupgradeneeded = () => {
        const db = request.result
        for (const storeName of ['tasks', 'images', 'thumbnails', 'amazonPlannerSessions']) {
          db.createObjectStore(storeName, { keyPath: 'id' })
        }
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const transaction = db.transaction('amazonPlannerSessions', 'readwrite')
        transaction.objectStore('amazonPlannerSessions').put({ id: 'legacy-session' })
        transaction.oncomplete = () => {
          db.close()
          resolve()
        }
        transaction.onerror = () => reject(transaction.error)
      }
    })
  })

  await page.goto('/#/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Amazon设计工作台' })).toBeVisible({ timeout: 15_000 })
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<{ version: number; sessionCount: number }>((resolve, reject) => {
            const request = indexedDB.open('amazon-image-studio')
            request.onerror = () => reject(request.error)
            request.onsuccess = () => {
              const db = request.result
              const transaction = db.transaction('amazonPlannerSessions', 'readonly')
              const getAll = transaction.objectStore('amazonPlannerSessions').getAll()
              getAll.onsuccess = () => {
                resolve({ version: db.version, sessionCount: getAll.result.length })
                db.close()
              }
              getAll.onerror = () => reject(getAll.error)
            }
          }),
      ),
    )
    .toEqual({ version: 4, sessionCount: 0 })
})
