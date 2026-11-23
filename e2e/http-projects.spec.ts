import { expect, test, type BrowserContext } from '@playwright/test'

const HTTP_ORIGIN = 'http://studio.test'
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLz4QAAAABJRU5ErkJggg=='

// Serve the local preview under an actual insecure origin without DNS, LAN access,
// upstream API traffic, or overriding browser crypto implementations.
async function serveInsecureOrigin(context: BrowserContext, baseURL: string) {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== HTTP_ORIGIN) return route.abort()
    const response = await route.fetch({ url: `${baseURL}${url.pathname}${url.search}` })
    await route.fulfill({ response })
  })
}

test('HTTP projects load, save, switch and retain uploaded images without randomUUID or subtle', async ({
  context,
  page,
  baseURL,
}) => {
  await serveInsecureOrigin(context, baseURL!)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${HTTP_ORIGIN}/#/`)
  expect(
    await page.evaluate(() => ({
      secure: window.isSecureContext,
      uuid: typeof crypto.randomUUID,
      subtle: typeof crypto.subtle,
      random: typeof crypto.getRandomValues,
    })),
  ).toEqual({ secure: false, uuid: 'undefined', subtle: 'undefined', random: 'function' })

  const name = page.getByRole('textbox', { name: '项目名称', exact: true })
  await expect(name).toBeVisible()
  await name.fill('HTTP image project')
  const firstId = await page.getByRole('combobox', { name: '切换项目' }).inputValue()
  await page
    .locator('input[type="file"][multiple]')
    .first()
    .setInputFiles({
      name: 'reference.png',
      mimeType: 'image/png',
      buffer: Buffer.from(PNG, 'base64'),
    })
  await expect(page.getByRole('button', { name: '上传产品参考图', exact: true })).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: '已自动保存' })).toBeVisible()
  await page.reload()
  await expect(name).toHaveValue('HTTP image project')
  await expect(page.getByRole('button', { name: '上传产品参考图', exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  await expect(name).toHaveValue('未命名项目')
  expect(await page.getByRole('combobox', { name: '切换项目' }).inputValue()).not.toBe(firstId)
  await page.getByRole('combobox', { name: '切换项目' }).selectOption(firstId)
  await expect(name).toHaveValue('HTTP image project')
  const imageIds = await page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const request = indexedDB.open('amazon-image-studio')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction('images')
          const keys = tx.objectStore('images').getAllKeys()
          tx.oncomplete = () => {
            resolve(keys.result.map(String))
            db.close()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
  )
  expect(imageIds.some((id) => id.startsWith('fallback-'))).toBe(true)
  expect(errors).toEqual([])
})

test('HTTP conflict recovery creates an independent copy without weakening revision protection', async ({
  context,
  page,
  baseURL,
}) => {
  await serveInsecureOrigin(context, baseURL!)
  await page.goto(`${HTTP_ORIGIN}/#/`)
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('Original HTTP project')
  await expect(page.getByRole('status').filter({ hasText: '已自动保存' })).toBeVisible()
  const originalId = await page.getByRole('combobox', { name: '切换项目' }).inputValue()
  const other = await context.newPage()
  await other.goto(`${HTTP_ORIGIN}/#/`)
  await other.getByRole('combobox', { name: '切换项目' }).selectOption(originalId)
  const draft = { name: '标题 / 五点描述', exact: true }
  await page.getByRole('textbox', draft).fill('Newer original draft')
  await expect(page.getByRole('status').filter({ hasText: '已自动保存' })).toBeVisible()
  await other.getByRole('textbox', draft).fill('Conflicting HTTP draft')
  await expect(other.getByRole('alert')).toContainText('其他页面更新')
  await other.getByRole('button', { name: '另存恢复副本', exact: true }).click()
  await expect(other.getByRole('alert')).toHaveCount(0)
  await expect(other.getByRole('textbox', draft)).toHaveValue('Conflicting HTTP draft')
  expect(await other.getByRole('combobox', { name: '切换项目' }).inputValue()).not.toBe(originalId)
  await page.reload()
  await expect(page.getByRole('textbox', draft)).toHaveValue('Newer original draft')
})
