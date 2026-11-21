import { expect, test } from '@playwright/test'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64',
)

const backgroundVariable = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.style.getPropertyValue('--site-background-image'))

test('custom workspace background applies immediately, survives reload, and restores the default', async ({ page }) => {
  await page.goto('/#/')
  const defaultBackground = await backgroundVariable(page)
  expect(defaultBackground).toContain('site-background.png')

  await page.getByLabel('设置', { exact: true }).click()
  await page.getByRole('button', { name: '习惯配置' }).click()
  const input = page.getByLabel('选择背景图片')
  await input.setInputFiles({ name: 'custom-background.png', mimeType: 'image/png', buffer: PNG })
  await expect(page.getByText('背景已更新，并会在下次启动时继续使用', { exact: true })).toBeVisible()
  const customBackground = await backgroundVariable(page)
  expect(customBackground).toContain('data:image/webp;base64,')
  expect(customBackground).not.toBe(defaultBackground)
  await page.screenshot({ path: 'output/playwright/site-background-settings.png', fullPage: true })

  await page.reload()
  expect(await backgroundVariable(page)).toBe(customBackground)

  await page.getByLabel('设置', { exact: true }).click()
  await page.getByRole('button', { name: '习惯配置' }).click()
  await page.getByRole('button', { name: '恢复默认' }).click()
  await expect(page.getByText('已恢复默认背景', { exact: true })).toBeVisible()
  expect(await backgroundVariable(page)).toContain('site-background.png')
})
