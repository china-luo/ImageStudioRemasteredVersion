import { expect, test } from '@playwright/test'
import { createEmptyPlannerWorkspace } from '../src/components/planner/plannerWorkspaceDraft'

test('planner keeps unfinished input after reload and workspace navigation', async ({ page, context }) => {
  await page.goto('/#/')
  const input = page.getByRole('textbox', { name: '标题 / 五点描述', exact: true })
  await input.fill('Title: Recovery test mug\n- Leak-resistant lid')
  const otherTab = await context.newPage()
  await otherTab.goto('/#/voc')
  await otherTab.bringToFront()
  await page.bringToFront()
  await expect(input).toHaveValue('Title: Recovery test mug\n- Leak-resistant lid')
  await page.reload()
  await expect(input).toHaveValue('Title: Recovery test mug\n- Leak-resistant lid')
  await page.goto('/#/voc')
  await expect(page.getByRole('heading', { name: 'Amazon VOC 评论分析' })).toBeVisible()
  await page.goto('/#/')
  await expect(input).toHaveValue('Title: Recovery test mug\n- Leak-resistant lid')
  await otherTab.reload()
  await otherTab.goto('/#/')
  await expect(otherTab.getByRole('textbox', { name: '标题 / 五点描述', exact: true })).toHaveValue('')
})

test('planner preserves recovered history, style images and prompt edits across reloads', async ({ page }) => {
  const draft = createEmptyPlannerWorkspace()
  draft.listingText = 'Saved history mug'
  draft.draft.productTitle = 'Recovery mug'
  draft.imagePlans = [
    {
      slot: 'MAIN',
      label: 'Recovery main',
      planMarkdown: 'Recovery plan details',
      prompt: 'A mug',
      negativePrompt: '',
    },
  ]
  draft.styleCandidates = [{ label: 'Recovery style', description: 'Warm tones', prompt: 'Warm', negativePrompt: '' }]
  draft.styleImages = [{ candidateIndex: 0, status: 'done', imageId: 'recovery-style' }]
  draft.selectedStyleIndex = 0
  draft.selectedPlanIndex = 0
  const session = {
    ...draft,
    id: 'recovery-session',
    title: 'Recovery mug',
    mode: draft.plannerMode,
    platform: draft.plannerPlatform,
    referenceImageIds: ['recovery-ref'],
    styleImages: [{ candidateIndex: 0, imageId: 'recovery-style' }],
    createdAt: 1,
    updatedAt: 1,
  }
  await page.goto('/#/')
  await expect(page.getByRole('heading', { name: 'Amazon设计工作台' })).toBeVisible()
  await page.evaluate(async (session) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('amazon-image-studio')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(['amazonPlannerSessions', 'images'], 'readwrite')
        tx.objectStore('amazonPlannerSessions').put(session)
        for (const id of ['recovery-style', 'recovery-ref']) {
          tx.objectStore('images').put({
            id,
            source: 'generated',
            createdAt: 1,
            dataUrl:
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLz4QAAAABJRU5ErkJggg==',
          })
        }
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
    })
  }, session)
  await page.reload()
  await page.getByRole('button', { name: /策划历史/ }).click()
  await page.getByRole('button', { name: '恢复', exact: true }).click()
  const input = page.getByRole('textbox', { name: '标题 / 五点描述', exact: true })
  await expect(input).toHaveValue('Saved history mug')
  await input.fill('Updated after history restore')
  await page.reload()
  await expect(input).toHaveValue('Updated after history restore')
  await expect(page.getByText('Recovery plan details', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('img', { name: 'Recovery style', exact: true })).toBeVisible()
  await expect(page.getByText(/已选择「Recovery style」/)).toBeVisible()
  await page.getByRole('button', { name: '提示词', exact: true }).first().click()
  const editor = page.locator('textarea[spellcheck="false"]')
  await editor.fill('Custom prompt after history restore')
  await page.getByRole('button', { name: '保存提示词', exact: true }).click()
  await page.reload()
  await page.getByRole('button', { name: '提示词', exact: true }).first().click()
  await expect(editor).toHaveValue('Custom prompt after history restore')
})

test('cleared planner input stays empty after reload', async ({ page }) => {
  await page.goto('/#/')
  const input = page.getByRole('textbox', { name: '标题 / 五点描述', exact: true })
  await input.fill('Discard this listing')
  await page.getByRole('button', { name: '清空', exact: true }).first().click()
  await page.reload()
  await expect(input).toHaveValue('')
})
