import { expect, test, type Locator, type Page } from '@playwright/test'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64',
)

async function openBackgroundSettings(page: Page) {
  await page.getByLabel('设置', { exact: true }).click()
  await page.getByRole('button', { name: '习惯配置' }).click()
  return page.getByRole('img', { name: '当前工作台背景预览' })
}

function readBackground(element: Locator) {
  return element.evaluate((node) => {
    const { backgroundColor, backgroundImage } = getComputedStyle(node)
    return { backgroundColor, backgroundImage }
  })
}

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/(fontsapi\.zeoseven\.com|cdn\.jsdelivr\.net)\//, (route) => route.abort())
})

test('默认预览与工作台背景一致，切换主题时同步变化', async ({ page }) => {
  await page.goto('/#/')
  const preview = await openBackgroundSettings(page)
  const body = page.locator('body')
  const settings = page.locator('.ui-modal').filter({ has: preview })

  await settings.getByRole('button', { name: '浅色', exact: true }).click()
  const light = await readBackground(body)
  expect(light.backgroundImage).toContain('radial-gradient(')
  expect(await readBackground(preview)).toEqual(light)

  await settings.getByRole('button', { name: '深色', exact: true }).click()
  const dark = await readBackground(body)
  expect(dark.backgroundImage).toContain('radial-gradient(')
  expect(dark).not.toEqual(light)
  expect(await readBackground(preview)).toEqual(dark)
})

test('自定义背景立即生效、刷新后保留，恢复默认后清除图片', async ({ page }) => {
  await page.goto('/#/')
  const preview = await openBackgroundSettings(page)
  const body = page.locator('body')
  const defaultBackground = await readBackground(body)
  const input = page.getByLabel('选择背景图片')
  await input.setInputFiles({ name: 'custom-background.png', mimeType: 'image/png', buffer: PNG })
  await expect(page.getByText('背景已更新，并会在下次启动时继续使用', { exact: true })).toBeVisible()
  const customBackground = await readBackground(body)
  expect(customBackground.backgroundImage).toContain('data:image/webp;base64,')
  expect(await readBackground(preview)).toEqual(customBackground)

  await page.reload()
  expect(await readBackground(body)).toEqual(customBackground)

  await openBackgroundSettings(page)
  const reset = page.getByRole('button', { name: '恢复默认', exact: true })
  await reset.click()
  await expect(page.getByText('已恢复默认背景', { exact: true })).toBeVisible()
  await expect(reset).toBeDisabled()
  expect(await readBackground(body)).toEqual(defaultBackground)
  expect(await readBackground(preview)).toEqual(defaultBackground)

  await page.reload()
  expect(await readBackground(body)).toEqual(defaultBackground)
})
