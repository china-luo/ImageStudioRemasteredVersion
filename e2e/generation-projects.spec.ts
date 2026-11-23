import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { createGenerationProject, ACTIVE_PROJECT_KEY } from '../src/lib/generationProjects'
import type { ApiProfile } from '../src/types'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLz4QAAAABJRU5ErkJggg=='

async function seedProject(page: Page) {
  const project = createGenerationProject()
  project.name = '随行杯项目'
  project.referenceImageIds = ['project-reference']
  project.workspace.listingText = 'Title: Travel mug\n- Leak-resistant lid'
  project.workspace.draft.productTitle = 'Travel mug'
  project.workspace.currentPlannerSessionId = 'plan-set-1'
  project.workspace.selectedPlanIndex = 0
  project.workspace.imagePlans = [
    {
      slot: 'MAIN',
      label: '白底主图',
      prompt: 'A travel mug on white.',
      negativePrompt: '',
      planMarkdown: '## 商品主图\n白底展示杯身和杯盖，保留真实比例。',
    },
  ]
  const profile: ApiProfile = {
    id: 'test-image-profile',
    name: 'Test image API',
    provider: 'openai',
    apiKey: '',
    timeout: 60,
    codexCli: false,
    baseUrl: 'https://image-api.test/v1',
    model: 'gpt-image-2',
    apiMode: 'images',
    apiProxy: false,
  }
  await page.goto('/manifest.webmanifest')
  await page.evaluate(
    async ({ project, png, profile, settings, activeKey }) => {
      localStorage.setItem(
        'amazon-image-studio',
        JSON.stringify({
          state: { settings: { ...settings, profiles: [profile], activeProfileId: profile.id } },
          version: 0,
        }),
      )
      sessionStorage.setItem(
        'amazon-image-studio-secrets',
        JSON.stringify({
          apiKey: 'test-only-placeholder',
          vocApiKey: '',
          profiles: { [profile.id]: 'test-only-placeholder' },
        }),
      )
      sessionStorage.setItem(activeKey, project.id)
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('amazon-image-studio', 5)
        request.onupgradeneeded = () => {
          for (const name of ['tasks', 'images', 'thumbnails', 'amazonPlannerSessions', 'generationProjects'])
            request.result.createObjectStore(name, { keyPath: 'id' })
        }
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction(['generationProjects', 'images'], 'readwrite')
          tx.objectStore('generationProjects').put(project)
          tx.objectStore('images').put({
            id: 'project-reference',
            dataUrl: `data:image/png;base64,${png}`,
            source: 'upload',
            createdAt: Date.now(),
          })
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      })
    },
    {
      project,
      png: PNG,
      profile,
      settings: { clearInputAfterSubmit: true, persistInputOnRestart: true },
      activeKey: ACTIVE_PROJECT_KEY,
    },
  )
  await page.goto('/#/')
  await expect(page.getByRole('textbox', { name: '项目名称', exact: true })).toHaveValue(project.name)
  return project
}

async function stage(page: Page, name: string) {
  await page
    .getByRole('navigation', { name: '制作阶段' })
    .getByRole('button', { name: new RegExp(name) })
    .click()
}

test('database v6 preserves v4 planning history and images', async ({ page }) => {
  await page.goto('/manifest.webmanifest')
  await page.evaluate(async (png) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('amazon-image-studio', 4)
      request.onupgradeneeded = () => {
        for (const name of ['tasks', 'images', 'thumbnails', 'amazonPlannerSessions'])
          request.result.createObjectStore(name, { keyPath: 'id' })
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result,
          tx = db.transaction(['amazonPlannerSessions', 'images'], 'readwrite')
        tx.objectStore('amazonPlannerSessions').put({
          id: 'v4-session',
          title: 'Existing history',
          referenceImageIds: ['v4-image'],
          styleImages: [],
          createdAt: 1,
          updatedAt: 1,
        })
        tx.objectStore('images').put({ id: 'v4-image', dataUrl: `data:image/png;base64,${png}` })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
    })
  }, PNG)
  await page.goto('/#/')
  await expect(page.getByRole('combobox', { name: '切换项目' })).toBeVisible()
  const state = await page.evaluate(
    () =>
      new Promise<{ version: number; ids: string[]; image: boolean }>((resolve, reject) => {
        const request = indexedDB.open('amazon-image-studio')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction(['amazonPlannerSessions', 'images'])
          const sessions = tx.objectStore('amazonPlannerSessions').getAllKeys(),
            image = tx.objectStore('images').get('v4-image')
          tx.oncomplete = () => {
            resolve({ version: db.version, ids: sessions.result.map(String), image: Boolean(image.result) })
            db.close()
          }
        }
      }),
  )
  expect(state).toEqual({ version: 6, ids: ['v4-session'], image: true })
})

test('projects preserve independent drafts and references across switching, reload and a new tab', async ({
  page,
  context,
}) => {
  const project = await seedProject(page)
  const input = page.getByRole('textbox', { name: '标题 / 五点描述', exact: true })
  await input.fill('Project A draft edited')
  await stage(page, '筛选与导出')
  await page.locator('.studio-inline-input [contenteditable="true"]').fill('Project A manual prompt')
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('同名商品')
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  await expect(input).toHaveValue('')
  await input.fill('Project B independent draft')
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('同名商品')
  const secondId = await page.getByRole('combobox', { name: '切换项目' }).inputValue()
  expect(secondId).not.toBe(project.id)
  await page.getByRole('combobox', { name: '切换项目' }).selectOption(project.id)
  await expect(input).toHaveValue('Project A draft edited')
  await stage(page, '筛选与导出')
  await expect(page.locator('.studio-inline-input [contenteditable="true"]')).toHaveText('Project A manual prompt')
  await stage(page, '商品资料')
  await page.reload()
  await expect(input).toHaveValue('Project A draft edited')
  await page.getByRole('combobox', { name: '切换项目' }).selectOption(secondId)
  await expect(input).toHaveValue('Project B independent draft')
  const otherTab = await context.newPage()
  await otherTab.goto('/#/')
  await otherTab.getByRole('combobox', { name: '切换项目' }).selectOption(project.id)
  await expect(otherTab.getByRole('textbox', { name: '标题 / 五点描述', exact: true })).toHaveValue(
    'Project A draft edited',
  )
  await expect
    .poll(() =>
      otherTab.evaluate(
        () =>
          new Promise<string[]>((resolve) => {
            const request = indexedDB.open('amazon-image-studio')
            request.onsuccess = () => {
              const db = request.result
              const read = db.transaction('images').objectStore('images').getAllKeys()
              read.onsuccess = () => {
                db.close()
                resolve(read.result.map(String))
              }
            }
          }),
      ),
    )
    .toContain('project-reference')
})

test('项目缺图可切换和重载，导入同 ID 的原图后立即恢复', async ({ page }) => {
  const first = await seedProject(page)
  const second = { ...createGenerationProject(), name: '暂缺参考图项目', referenceImageIds: ['missing-reference'] }
  const openDataSettings = async () => {
    await page.getByRole('banner').getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '数据管理', exact: true }).click()
  }
  const upload = async (manifest: object, files: Record<string, Uint8Array> = {}) => {
    const buffer = Buffer.from(
      zipSync({ 'manifest.json': strToU8(JSON.stringify({ version: 5, ...manifest })), ...files }),
    )
    await page
      .locator('input[type=file][accept=".zip"]')
      .setInputFiles({ name: 'fixture.zip', mimeType: 'application/zip', buffer })
    await expect(page.getByText(/已导入 0 条记录/)).toBeVisible()
    await page.getByRole('button', { name: '关闭', exact: true }).click()
  }
  await openDataSettings()
  await upload({ generationProjects: [second] })
  const selector = page.getByRole('combobox', { name: '切换项目' })
  const warning = page.getByText(/1 张项目参考图暂未找到/)
  const name = page.getByRole('textbox', { name: '项目名称', exact: true })
  await selector.selectOption(second.id)
  await expect(warning).toBeVisible()
  await name.fill('缺图期间修改项目')
  await expect(page.getByText('已自动保存', { exact: true })).toBeVisible()
  await selector.selectOption(first.id)
  await expect(warning).toHaveCount(0)
  await selector.selectOption(second.id)
  await page.reload()
  await expect(name).toHaveValue('缺图期间修改项目')
  await expect(warning).toBeVisible()
  await openDataSettings()
  await upload(
    { imageFiles: { 'missing-reference': { path: 'image.png' } } },
    { 'image.png': Buffer.from(PNG, 'base64') },
  )
  await expect(warning).toHaveCount(0)
  await page.reload()
  await expect(name).toHaveValue('缺图期间修改项目')
  await expect(warning).toHaveCount(0)
})

test('清空数据会取消生成，迟到的响应不会重建记录或图片', async ({ page }) => {
  await seedProject(page)
  let release!: () => void
  const allowResponse = new Promise<void>((resolve) => {
    release = resolve
  })
  const urlPattern = /(?:https:\/\/image-api\.test\/|\/api-proxy\/https%3A%2F%2Fimage-api\.test)/
  await page.evaluate(() => {
    const fetchImpl = window.fetch
    window.fetch = (input, init) => {
      if (!String(input).includes('image-api.test')) return fetchImpl(input, init)
      init?.signal?.addEventListener(
        'abort',
        () => {
          document.documentElement.dataset.fixtureRequestAborted = 'true'
        },
        { once: true },
      )
      // 模拟忽略取消的服务商，确保迟到响应仍不能写回。
      return fetchImpl(input, { ...init, signal: undefined })
    }
  })
  await page.route(urlPattern, async (route) => {
    await allowResponse
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ b64_json: PNG }] }),
    })
  })
  try {
    const submitted = page.waitForRequest(urlPattern)
    await stage(page, '图片制作')
    await page.getByRole('button', { name: '提交生成', exact: true }).click()
    await submitted
    await page.getByRole('banner').getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '数据管理', exact: true }).click()
    await page.getByRole('button', { name: '清空所选数据', exact: true }).click()
    await page.getByRole('button', { name: '确认清空', exact: true }).click()
    await expect(page.getByText('所选数据已清空')).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-fixture-request-aborted', 'true')
    const response = page.waitForResponse(urlPattern)
    release()
    expect((await response).status()).toBe(200)
    const counts = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('amazon-image-studio')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      try {
        return await new Promise<[number, number]>((resolve, reject) => {
          const tx = db.transaction(['tasks', 'images'])
          const tasks = tx.objectStore('tasks').count()
          const images = tx.objectStore('images').count()
          tx.oncomplete = () => resolve([tasks.result, images.result])
          tx.onabort = () => reject(tx.error)
        })
      } finally {
        db.close()
      }
    })
    expect(counts).toEqual([0, 0])
  } finally {
    release()
  }
})

test('generation versions remain associated with a renamed project and export only the selected final', async ({
  page,
}) => {
  const project = await seedProject(page)
  let requestCount = 0
  await page.route(/(?:https:\/\/image-api\.test\/|\/api-proxy\/https%3A%2F%2Fimage-api\.test)/, async (route) => {
    requestCount++
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        output_format: 'png',
        data: [{ url: `data:image/png;base64,${PNG}`, output_format: 'png' }],
      }),
    })
  })
  await stage(page, '图片制作')
  await page.getByRole('button', { name: '提交生成', exact: true }).click()
  const versions = page.getByRole('region', { name: '当前图片位版本', exact: true })
  await expect(versions.getByText('已完成', { exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: '生成新版本', exact: true }).click()
  await expect(versions.getByText('已完成', { exact: true })).toHaveCount(2)
  expect(requestCount).toBe(2)
  await versions.getByRole('button', { name: '选为定稿', exact: true }).nth(1).click()
  await page.getByRole('textbox', { name: '项目名称', exact: true }).fill('Mug renamed')
  await stage(page, '筛选与导出')
  const results = page.getByRole('region', { name: '当前项目结果', exact: true })
  await expect(results.getByRole('button', { name: '已定稿 · 取消', exact: true })).toHaveCount(1)
  await page.reload()
  await stage(page, '筛选与导出')
  await expect(results.getByText('已完成', { exact: true })).toHaveCount(2)
  const overviewGrid = results.locator('.project-version-grid--overview')
  await expect(overviewGrid).toBeVisible()
  await expect(overviewGrid.locator('.project-version-context')).toHaveCount(2)
  const overviewCardRows = await overviewGrid
    .locator('[data-project-task-id]')
    .evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().y)))
  expect(new Set(overviewCardRows).size).toBe(1)
  const downloadEvent = page.waitForEvent('download')
  await results.getByRole('button', { name: '导出定稿（1）', exact: true }).click()
  const download = await downloadEvent
  expect(download.suggestedFilename()).toBe('Mug renamed_定稿.zip')
  const files = unzipSync(new Uint8Array(await readFile((await download.path())!)))
  expect(Object.keys(files)).toEqual(['01_amazon-listing_MAIN.png', 'manifest.json'])
  const manifest = JSON.parse(strFromU8(files['manifest.json']))
  expect(manifest.projectId).toBe(project.id)
  expect(manifest.images).toHaveLength(1)
  const taskIds = await results
    .locator('[data-project-task-id]')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-project-task-id')))
  expect(manifest.images[0].taskId).toBe(taskIds[1])
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => window.scrollTo(0, 0))
  const [navigationBox, resultsStageBox, settingsBox, versionGridBox] = await Promise.all([
    page.getByRole('navigation', { name: '功能导航' }).boundingBox(),
    page.getByRole('region', { name: '生成记录与导出' }).boundingBox(),
    page.getByRole('complementary', { name: '生成操作与设置' }).boundingBox(),
    results.locator('.project-version-grid').boundingBox(),
  ])
  const versionBoxes = await results.locator('[data-project-task-id]').evaluateAll((items) =>
    items.map((item) => {
      const box = item.getBoundingClientRect()
      return { x: box.x, width: box.width }
    }),
  )
  expect(navigationBox!.width).toBeGreaterThanOrEqual(224)
  expect(Math.abs(resultsStageBox!.x - settingsBox!.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(resultsStageBox!.width - settingsBox!.width)).toBeLessThanOrEqual(1)
  expect(versionBoxes[0]!.width).toBeGreaterThanOrEqual(280)
  const leftGap = versionBoxes[0]!.x - versionGridBox!.x
  const rightGap = versionGridBox!.x + versionGridBox!.width - (versionBoxes.at(-1)!.x + versionBoxes.at(-1)!.width)
  expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(2)
  await page.screenshot({ path: 'output/playwright/ui-phase2-results.png', fullPage: true })
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.evaluate(() => window.scrollTo(0, 0))
  const wideGridBox = await results.locator('.project-version-grid').boundingBox()
  const wideVersionBoxes = await results.locator('[data-project-task-id]').evaluateAll((items) =>
    items.map((item) => {
      const box = item.getBoundingClientRect()
      return { x: box.x, width: box.width }
    }),
  )
  const wideLeftGap = wideVersionBoxes[0]!.x - wideGridBox!.x
  const wideRightGap =
    wideGridBox!.x + wideGridBox!.width - (wideVersionBoxes.at(-1)!.x + wideVersionBoxes.at(-1)!.width)
  expect(Math.abs(wideLeftGap - wideRightGap)).toBeLessThanOrEqual(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1920)
  await page.screenshot({ path: 'output/playwright/layout-balance-1920.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: 'output/playwright/ui-phase2-dark.png', fullPage: true, animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.scrollTo(0, 0))
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391)
  await page.screenshot({ path: 'output/playwright/ui-phase2-mobile.png', fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  await stage(page, '筛选与导出')
  await expect(
    page.getByRole('region', { name: '当前项目结果', exact: true }).locator('[data-project-task-id]'),
  ).toHaveCount(0)
})

test('another tab cannot overwrite a newer project revision', async ({ page, context }) => {
  const project = await seedProject(page)
  const other = await context.newPage()
  await other.goto('/#/')
  await other.getByRole('combobox', { name: '切换项目' }).selectOption(project.id)
  await page.getByRole('textbox', { name: '标题 / 五点描述', exact: true }).fill('New revision from first tab')
  await expect(page.getByRole('status').filter({ hasText: '已自动保存' })).toBeVisible()
  await other.getByRole('textbox', { name: '标题 / 五点描述', exact: true }).fill('Conflicting draft')
  await expect(other.getByRole('alert')).toContainText('其他页面更新')
  await other.getByRole('button', { name: '另存恢复副本', exact: true }).click()
  await expect(other.getByRole('textbox', { name: '标题 / 五点描述', exact: true })).toHaveValue('Conflicting draft')
  await page.reload()
  await expect(page.getByRole('textbox', { name: '标题 / 五点描述', exact: true })).toHaveValue(
    'New revision from first tab',
  )
})
