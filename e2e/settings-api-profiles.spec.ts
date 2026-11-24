import { expect, test } from '@playwright/test'

test('custom provider proxy preference is editable and survives settings reopen under the default local proxy', async ({
  page,
}) => {
  // Only capability discovery is mocked. No provider request or real credential is used.
  await page.route('**/__amazon-image-studio/proxy-config', (route) =>
    route.fulfill({
      json: {
        enabled: true,
        prefix: '/api-proxy',
        target: 'http://127.0.0.1/__dynamic-api-proxy__/v1',
        changeOrigin: true,
        secure: true,
      },
    }),
  )
  await page.addInitScript(() => {
    localStorage.setItem(
      'amazon-image-studio',
      JSON.stringify({
        state: {
          settings: {
            customProviders: [
              {
                id: 'custom-browser-jobs',
                name: 'Browser Jobs',
                template: 'http-image',
                submit: { path: 'jobs/submit', taskIdPath: 'task_id' },
                poll: {
                  path: 'jobs/{task_id}',
                  statusPath: 'status',
                  successValues: ['SUCCESS'],
                  failureValues: ['FAILURE'],
                  result: { b64JsonPaths: ['b64_json'] },
                },
              },
            ],
            profiles: [
              {
                id: 'browser-jobs-profile',
                name: 'Browser Jobs Profile',
                provider: 'custom-browser-jobs',
                baseUrl: 'https://api.example.com/v1',
                apiKey: '',
                model: 'image-model',
                timeout: 60,
                apiMode: 'images',
                codexCli: false,
                apiProxy: false,
              },
            ],
            activeProfileId: 'browser-jobs-profile',
          },
        },
        version: 0,
      }),
    )
  })
  await page.goto('/#/', { waitUntil: 'domcontentloaded' })
  await page.getByRole('banner').getByRole('button', { name: '设置', exact: true }).click()
  const proxySwitch = page.getByRole('switch', { name: 'API 代理', exact: true })
  await expect(proxySwitch).toBeEnabled()
  await expect(proxySwitch).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByText('其他自定义路径由浏览器直连', { exact: false })).toBeVisible()
  await expect(page.getByLabel('图片生成 API URL', { exact: true })).toBeEnabled()
  await proxySwitch.click()
  await expect(proxySwitch).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: '保存 API 配置', exact: true }).click()
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('banner').getByRole('button', { name: '设置', exact: true }).click()
  await expect(proxySwitch).toBeEnabled()
  await expect(proxySwitch).toHaveAttribute('aria-checked', 'true')
  await proxySwitch.click()
  await expect(proxySwitch).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('banner').getByRole('button', { name: '设置', exact: true }).click()
  await expect(proxySwitch).toHaveAttribute('aria-checked', 'false')
})

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
  await expect(page.getByTestId('analysis-bindings')).toContainText('拆图反推配置')
  await expect(page.getByTestId('analysis-bindings')).not.toContainText('VOC')
  await expect(page.getByTestId('analysis-bindings')).not.toContainText('Shulex')
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
