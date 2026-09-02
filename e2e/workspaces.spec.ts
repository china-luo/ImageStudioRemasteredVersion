import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/#/', { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.removeItem('amazon-image-studio'))
})

test('SOP keeps form state across workspace navigation and disables invalid prompt copy', async ({ page }) => {
  await page.goto('/#/sop', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '电商图片拆解反推 SOP' })).toBeVisible({ timeout: 15_000 })

  await page.getByLabel('自家产品名称').fill('Portable pet water bottle')
  await page.getByLabel('自家产品核心卖点').fill('Leak-resistant lid and one-hand use')
  await page.goto('/#/voc', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Amazon VOC 评论分析' })).toBeVisible()
  await page.goto('/#/sop', { waitUntil: 'domcontentloaded' })

  await expect(page.getByLabel('自家产品名称')).toHaveValue('Portable pet water bottle')
  await expect(page.getByRole('button', { name: '复制英文提示词' })).toBeDisabled()
})

test('VOC rejects a CSV with no valid review body', async ({ page }) => {
  await page.goto('/#/voc', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Amazon VOC 评论分析' })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: '文件导入' }).click()
  await page.getByLabel('或粘贴 CSV 内容').fill('title,rating,body\nToo short,1,x')
  await page.getByRole('button', { name: '解析 CSV' }).click()

  await expect(page.getByText('没有可用的有效评论')).toBeVisible()
  await expect(page.getByRole('button', { name: 'VOC AI 分析' })).toBeDisabled()
})
