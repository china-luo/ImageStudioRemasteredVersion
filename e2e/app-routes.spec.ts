import { expect, test } from '@playwright/test'

test('opens SOP, VOC, and editor from URL hashes', async ({ page }) => {
  await page.goto('/#/sop', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '电商图片拆解反推 SOP' })).toBeVisible({ timeout: 15_000 })

  await page.goto('/#/voc', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Amazon VOC 评论分析' })).toBeVisible()

  await page.goto('/#/editor', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '图片编辑' })).toBeVisible()
})
