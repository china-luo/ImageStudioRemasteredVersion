import { expect, test } from '@playwright/test'
import { createEmptyPlannerWorkspace, PLANNER_WORKSPACE_KEY } from '../src/components/planner/plannerWorkspaceDraft'

test('stage navigation preserves mounted inputs and keeps generation explicit', async ({ page }) => {
  const apiRequests: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST') apiRequests.push(request.url())
  })
  await page.goto('/#/')
  const stages = page.getByRole('navigation', { name: '制作阶段' })
  const listing = page.getByRole('textbox', { name: '标题 / 五点描述', exact: true })
  await listing.fill('Layout test: stainless steel travel mug')
  await listing.evaluate((element) => element.setAttribute('data-mount-check', 'original'))
  for (const stage of ['策划与风格', '图片制作', '筛选与导出', '商品资料']) {
    await stages.getByRole('button', { name: new RegExp(stage) }).click()
    await expect(stages.getByRole('button', { name: new RegExp(stage) })).toHaveAttribute('aria-current', 'step')
  }
  await expect(listing).toHaveValue('Layout test: stainless steel travel mug')
  await expect(listing).toHaveAttribute('data-mount-check', 'original')
  expect(apiRequests).toEqual([])
  const nav = page.getByRole('navigation', { name: '功能导航' })
  await nav.getByRole('button', { name: /VOC评论/ }).click()
  await expect(page).toHaveURL(/#\/voc$/)
  await nav.getByRole('button', { name: /图片生成/ }).click()
  await expect(listing).toHaveValue('Layout test: stainless steel travel mug')
})

test('快捷面板 Enter 激活获得焦点的按钮，搜索框仍可用方向键选择', async ({ page }) => {
  await page.goto('/#/')
  await expect(page.getByRole('textbox', { name: '项目名称', exact: true })).toBeVisible()
  const palette = page.getByRole('dialog', { name: '快捷命令面板' })
  const search = palette.getByRole('textbox')
  const editor = palette.getByRole('button', { name: /^图片编辑/ })

  await page.keyboard.press('Control+k')
  await expect(search).toBeFocused()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(editor).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#\/editor$/)
  await expect(palette).toHaveCount(0)

  await page.keyboard.press('Control+k')
  await expect(search).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(palette.locator('[data-active="true"]')).toContainText('拆图反推 SOP')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#\/sop$/)
  await expect(palette).toHaveCount(0)
})

test('production layout keeps plan selection, batch selection and prompt editing available', async ({ page }) => {
  const draft = createEmptyPlannerWorkspace()
  draft.listingText = 'Title: Stainless Steel Travel Mug\n- Leak-resistant lid\n- 500 ml capacity'
  draft.draft.productTitle = '不锈钢随行杯'
  draft.imagePlans = [
    {
      slot: 'MAIN',
      label: '白底商品主图',
      planMarkdown:
        '## 画面目标\n完整呈现杯身与杯盖，白底构图。\n\n## 构图与光线\n商品居中，保留自然阴影，突出真实材质。',
      prompt: 'A stainless steel travel mug on white.',
      negativePrompt: 'text, watermark',
    },
    {
      slot: 'PT01',
      label: '密封结构展示',
      planMarkdown: '## 密封结构\n展示杯盖密封圈与杯口细节，说明防漏设计。',
      prompt: 'A close-up of the mug lid.',
      negativePrompt: 'watermark',
    },
  ]
  draft.selectedPlanIndex = 0
  await page.addInitScript(({ key, draft }) => sessionStorage.setItem(key, JSON.stringify(draft)), {
    key: PLANNER_WORKSPACE_KEY,
    draft,
  })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/#/')
  await page.screenshot({ path: 'output/playwright/ui-phase1-details.png', fullPage: true })
  await page
    .getByRole('navigation', { name: '制作阶段' })
    .getByRole('button', { name: /图片制作/ })
    .click()
  const content = page.getByRole('region', { name: '当前方案内容' })
  await expect(content.getByRole('heading', { name: '画面目标' })).toBeVisible()
  await page.getByRole('checkbox', { name: '选择 PT01 批量生成' }).check()
  await expect(page.getByRole('button', { name: '批量生成 1', exact: true })).toBeVisible()
  await page
    .getByRole('complementary', { name: '图片位列表' })
    .getByRole('button', { name: /PT01 密封结构展示/ })
    .click()
  await expect(content.getByRole('heading', { name: '密封结构', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '提示词', exact: true }).click()
  const editor = page.locator('textarea[spellcheck="false"]')
  await editor.fill('Edited lid detail prompt')
  await page.getByRole('button', { name: '保存提示词', exact: true }).click()
  await page.getByRole('button', { name: '提示词', exact: true }).click()
  await expect(editor).toHaveValue('Edited lid detail prompt')
  await page.getByRole('button', { name: '关闭提示词编辑', exact: true }).click()
  await page.screenshot({ path: 'output/playwright/ui-phase1-production.png', fullPage: true })
  const boxes = await Promise.all([
    page.getByRole('complementary', { name: '图片位列表' }).boundingBox(),
    content.boundingBox(),
    page.getByRole('complementary', { name: '生成操作与设置' }).boundingBox(),
  ])
  expect(boxes[0]!.x + boxes[0]!.width).toBeLessThanOrEqual(boxes[1]!.x + 1)
  expect(boxes[1]!.x + boxes[1]!.width).toBeLessThanOrEqual(boxes[2]!.x + 1)
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.getByRole('button', { name: 'Amazon', exact: true })).toHaveCSS(
    'background-color',
    'rgba(255, 255, 255, 0.1)',
  )
  await page.screenshot({ path: 'output/playwright/ui-phase1-dark.png', fullPage: true, animations: 'disabled' })
})

test('A+ module controls and TikTok modes remain reachable through the reorganized layout', async ({ page }) => {
  await page.goto('/#/')
  await page.getByRole('button', { name: 'A+ 图', exact: true }).click()
  const addModule = page.getByRole('button', { name: /后添加同尺寸 A\+ 模块/ })
  const count = await addModule.count()
  expect(count).toBeGreaterThan(0)
  await addModule.first().click()
  await expect(addModule).toHaveCount(count + 1)
  await page
    .getByRole('navigation', { name: '制作阶段' })
    .getByRole('button', { name: /策划与风格/ })
    .click()
  await page
    .getByRole('navigation', { name: '制作阶段' })
    .getByRole('button', { name: /商品资料/ })
    .click()
  await expect(addModule).toHaveCount(count + 1)
  await page.getByRole('button', { name: 'TikTok', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'TikTok 商品图设计工作台' })).toBeVisible()
  await page.getByRole('button', { name: '商品详情图', exact: true }).click()
  await expect(page.getByText(/当前板块：TikTok 商品详情图/)).toBeVisible()
})

test('mobile navigation and all stages fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/')
  const nav = page.getByRole('navigation', { name: '功能导航' })
  await expect(nav.getByRole('button', { name: /VOC评论/ })).toBeVisible()
  for (const stage of ['商品资料', '策划与风格', '图片制作', '筛选与导出']) {
    await page
      .getByRole('navigation', { name: '制作阶段' })
      .getByRole('button', { name: new RegExp(stage) })
      .click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391)
  }
  await page.screenshot({ path: 'output/playwright/ui-phase1-mobile-results.png', fullPage: true })
  await page
    .getByRole('navigation', { name: '制作阶段' })
    .getByRole('button', { name: /商品资料/ })
    .click()
  await page.screenshot({ path: 'output/playwright/ui-phase1-mobile.png', fullPage: true })
})
