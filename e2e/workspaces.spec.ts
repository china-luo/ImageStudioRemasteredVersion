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
  await page.getByLabel('或粘贴 CSV / Excel 表格').fill('title,rating,body\nToo short,1,x')
  await page.getByRole('button', { name: '分析粘贴内容' }).click()

  await expect(page.getByRole('alert')).toContainText('没有可用的有效评论')
  await expect(page.getByRole('button', { name: 'HTML', exact: true })).toBeDisabled()
})

test('VOC imports and exports offline without API configuration', async ({ page, context }) => {
  await page.goto('/#/voc', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Amazon VOC 评论分析' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: /ASIN 拉取|VOC AI 分析|配置 VOC/ })).toHaveCount(0)
  await context.setOffline(true)

  const requests: string[] = []
  page.on('request', (request) => {
    if (['fetch', 'xhr'].includes(request.resourceType())) requests.push(request.url())
  })
  await page.getByLabel('评论文件').setInputFiles({
    name: 'reviews.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('rating,body\n1,Broke within a week\n5,Great quality for the price\n,No rating'),
  })
  await expect(page.getByRole('heading', { name: '星级分布' })).toBeVisible()
  await expect(page.getByText('未评分或无有效评分 1 条')).toBeVisible()
  await expect(page.getByText('Broke within a week', { exact: true })).toBeVisible()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'HTML', exact: true }).click()
  expect((await downloading).suggestedFilename()).toBe('voc-dashboard.html')
  expect(requests).toEqual([])

  await context.setOffline(false)
  await page.reload()
  await expect(page.getByText('已加载 3 条评论')).toBeVisible()
})
