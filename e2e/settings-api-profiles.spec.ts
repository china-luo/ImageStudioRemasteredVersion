import { expect, test } from '@playwright/test'

test('keeps image and AI planning API profiles separated in settings', async ({ page }) => {
  await page.goto('/#/', { waitUntil: 'domcontentloaded' })
  await page.getByRole('banner').getByRole('button', { name: '设置', exact: true }).click()

  const generationTab = page.getByRole('tab', { name: '图片生成', exact: true })
  const analysisTab = page.getByRole('tab', { name: 'AI 策划', exact: true })
  const profilePicker = page.getByTestId('api-profile-picker')

  await expect(generationTab).toHaveAttribute('aria-selected', 'true')
  await profilePicker.click()
  const generationList = page.getByRole('listbox', { name: 'API 配置列表' })
  await expect(generationList.getByRole('option')).toHaveCount(1)
  await expect(generationList.getByRole('option')).not.toContainText('AI 策划')

  await analysisTab.click()
  await expect(page.getByRole('heading', { name: 'AI 策划配置', exact: true })).toBeVisible()
  await expect(page.getByTestId('analysis-bindings')).toBeVisible()
  await profilePicker.click()
  const analysisList = page.getByRole('listbox', { name: 'API 配置列表' })
  await expect(analysisList.getByRole('option')).toHaveCount(1)
  await expect(analysisList.getByRole('option')).toContainText('AI 策划')

  const plannerModel = page.getByTestId('api-model-input')
  await plannerModel.fill('planner-e2e-model')
  await generationTab.click()
  await expect(page.getByTestId('api-model-input')).toHaveValue('gpt-image-2')
  await analysisTab.click()
  await expect(page.getByTestId('api-model-input')).toHaveValue('planner-e2e-model')

  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('banner').getByRole('button', { name: '设置', exact: true }).click()
  await analysisTab.click()
  await expect(page.getByTestId('api-model-input')).toHaveValue('planner-e2e-model')

  // Keep the test context clean for any following tests.
  await page.getByTestId('api-model-input').fill('gpt-5.5')
  await page.getByRole('button', { name: '关闭', exact: true }).click()
})
