import { expect, test } from '@playwright/test'
import { DEFAULT_PARAMS, type TaskRecord } from '../src/types'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWm0AAAAASUVORK5CYII=',
  'base64',
)

function updateStartupFixture({ tasks, seed }: { tasks: TaskRecord[]; seed: boolean }) {
  return new Promise<boolean>((resolve, reject) => {
    const request = indexedDB.open('amazon-image-studio')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(['tasks', 'images'], seed ? 'readwrite' : 'readonly')
      const images = tx.objectStore('images')
      if (seed) {
        for (const task of tasks) tx.objectStore('tasks').put(task)
        images.put({
          id: 'orphan-isolation-test',
          dataUrl: 'data:image/png;base64,AAAA',
          source: 'upload',
          createdAt: 1,
        })
      }
      const key = images.getKey('orphan-isolation-test')
      tx.oncomplete = () => {
        db.close()
        resolve(Boolean(key.result))
      }
      tx.onabort = () => {
        db.close()
        reject(tx.error)
      }
    }
  })
}

test('直达本地工具不查询远端任务，打开在线工具时只恢复对应任务', async ({ page }) => {
  const provider = 'isolation-provider'
  const profileId = 'isolation-profile'
  await page.addInitScript(
    ({ provider, profileId }) => {
      localStorage.setItem(
        'amazon-image-studio',
        JSON.stringify({
          state: {
            settings: {
              activeProfileId: profileId,
              profiles: [
                {
                  id: profileId,
                  name: '测试配置',
                  provider,
                  baseUrl: 'https://isolation-api.test/v1',
                  apiMode: 'images',
                  model: 'fixture',
                  apiProxy: false,
                },
              ],
              customProviders: [
                {
                  id: provider,
                  name: '测试服务商',
                  template: 'http-image',
                  submit: { path: 'jobs/submit', taskIdPath: 'task_id' },
                  poll: {
                    path: 'jobs/{task_id}',
                    method: 'GET',
                    statusPath: 'status',
                    successValues: ['SUCCESS'],
                    failureValues: ['FAILURE'],
                    result: { b64JsonPaths: ['b64_json'] },
                  },
                },
              ],
            },
          },
          version: 0,
        }),
      )
      sessionStorage.setItem('amazon-image-studio-secrets', JSON.stringify({ profiles: { [profileId]: 'test-only' } }))
    },
    { provider, profileId },
  )
  const requests: string[] = []
  await page.route('https://isolation-api.test/**', async (route) => {
    const request = route.request()
    requests.push(`${request.method()} ${new URL(request.url()).pathname}`)
    await route.fulfill({ json: { status: 'SUCCESS', b64_json: PNG.toString('base64') } })
  })
  await page.goto('/#/')
  await expect(page.getByRole('heading', { name: 'Amazon设计工作台' })).toBeVisible()
  const generationTask: TaskRecord = {
    id: 'isolated-generation',
    prompt: '任务隔离测试',
    params: DEFAULT_PARAMS,
    inputImageIds: [],
    outputImages: [],
    status: 'running',
    error: null,
    createdAt: 1,
    finishedAt: null,
    elapsed: null,
    apiProvider: provider,
    apiProfileId: profileId,
    customTaskId: 'generation-remote',
  }
  const editorTask: TaskRecord = {
    ...generationTask,
    id: 'isolated-editor',
    customTaskId: 'editor-remote',
    category: { workflow: 'seedream-edit' },
  }
  expect(await page.evaluate(updateStartupFixture, { tasks: [generationTask, editorTask], seed: true })).toBe(true)
  // 使用完整导航，确保上次打开图片生成时设置的恢复状态不会沿用。
  await page.goto('/#/voc')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Amazon VOC 评论分析' })).toBeVisible()
  await expect.poll(() => page.evaluate(updateStartupFixture, { tasks: [], seed: false })).toBe(false)
  expect(requests).toEqual([])

  await page.getByRole('button', { name: /图片编辑/ }).click()
  await expect.poll(() => requests).toEqual(['GET /v1/jobs/editor-remote'])
  await page.getByRole('button', { name: /图片生成/ }).click()
  await expect.poll(() => requests).toEqual(['GET /v1/jobs/editor-remote', 'GET /v1/jobs/generation-remote'])
})

test('绑定编辑器或拆图配置不改变首页和策划的默认配置', async ({ page }) => {
  await page.goto('/#/editor')
  await expect(page.getByText(/尚未绑定通用图片编辑 API/)).toBeVisible()
  await page.getByRole('button', { name: '编辑配置', exact: true }).click()
  const editor = page.getByRole('combobox', { name: '通用编辑 API 配置' })
  await expect(editor).toHaveValue('')
  await editor.selectOption({ index: 1 })
  await expect(editor).not.toHaveValue('')
  const settings = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('amazon-image-studio') ?? '{}').state.settings)
  const bound = await settings()
  expect(bound.imageEditorProfileId).toBe(bound.activeProfileId)
  await page.getByRole('button', { name: '关闭', exact: true }).click()

  await page
    .getByRole('navigation', { name: '功能导航' })
    .getByRole('button', { name: /拆图反推/ })
    .click()
  await expect(page.getByText('拆图 AI 待配置', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '配置拆图 AI' }).click()
  const sop = page.getByRole('combobox', { name: '拆图反推配置' })
  await expect(sop).toHaveValue('')
  await sop.selectOption({ index: 1 })
  const after = await settings()
  expect(after).toMatchObject({
    activeProfileId: bound.activeProfileId,
    amazonPlannerProfileId: bound.amazonPlannerProfileId,
    imageEditorProfileId: bound.imageEditorProfileId,
    sopReverseProfileId: bound.amazonPlannerProfileId,
  })
})

test('人物打标跨工作区保留队列和结果，不自动下载', async ({ page }) => {
  await page.goto('/#/tagger')
  await expect(page.getByRole('heading', { name: 'AI 人物打标' })).toBeVisible()
  await page
    .locator('input[type=file][multiple]')
    .setInputFiles({ name: 'tag-source.png', mimeType: 'image/png', buffer: PNG })
  const downloads: string[] = []
  page.on('download', (download) => downloads.push(download.suggestedFilename()))
  await page.getByRole('button', { name: '一键写入 XMP 标记' }).click()
  await page.getByRole('button', { name: /VOC评论/ }).click()
  await expect(page.getByRole('heading', { name: 'Amazon VOC 评论分析' })).toBeVisible()
  await page.getByRole('button', { name: /AI 人物打标/ }).click()
  await expect(page.getByText('tag-source.png', { exact: true })).toBeVisible()
  const downloadButton = page.getByRole('button', { name: /下载已打标文件/ })
  await expect(downloadButton).toBeVisible()
  expect(downloads).toEqual([])
  const download = page.waitForEvent('download')
  await downloadButton.click()
  expect((await download).suggestedFilename()).toBe('tag-source.png')
})

declare global {
  interface Window {
    releaseStartupCleanup?: () => void
    releaseUpload?: () => void
  }
}

const fixtureTask: TaskRecord = {
  id: 'fixture-task',
  prompt: '时序回归测试',
  params: DEFAULT_PARAMS,
  inputImageIds: [],
  outputImages: [],
  status: 'done',
  error: null,
  createdAt: 1,
  finishedAt: 2,
  elapsed: 1,
}

test('启动恢复只续查历史任务，不为新编辑开启第二条轮询', async ({ page }) => {
  await page.goto('/#/voc')
  await page.evaluate(updateStartupFixture, {
    tasks: [
      {
        ...fixtureTask,
        status: 'running',
        finishedAt: null,
        elapsed: null,
        apiProvider: 'fixture-provider',
        apiProfileId: 'fixture-profile',
        customTaskId: 'historic',
        category: { workflow: 'seedream-edit' },
        imageEditContext: { engine: 'seedream', sourceImageId: 'unused', referenceImageIds: [], userInstruction: '' },
      },
    ],
    seed: true,
  })
  await page.addInitScript(() => {
    // 延迟清理的读操作回调，不锁住数据库或阻塞新任务写入。
    const getAllKeys = IDBObjectStore.prototype.getAllKeys
    IDBObjectStore.prototype.getAllKeys = function (...args) {
      const request = getAllKeys.apply(this, args)
      if (this.name === 'images' && !window.releaseStartupCleanup) {
        const tx = this.transaction
        const oncomplete = tx.oncomplete
        tx.oncomplete = (event) => {
          window.releaseStartupCleanup = () => oncomplete?.call(tx, event)
        }
      }
      return request
    }
    const endpoint = { path: 'jobs/submit', taskIdPath: 'task_id' }
    localStorage.setItem(
      'amazon-image-studio',
      JSON.stringify({
        state: {
          settings: {
            activeProfileId: 'fixture-profile',
            imageEditorProfileId: 'fixture-profile',
            profiles: [
              {
                id: 'fixture-profile',
                name: '测试配置',
                provider: 'fixture-provider',
                baseUrl: 'https://isolation-api.test/v1',
                model: 'fixture',
                apiMode: 'images',
                apiProxy: false,
              },
            ],
            customProviders: [
              {
                id: 'fixture-provider',
                name: '测试服务商',
                template: 'http-image',
                submit: endpoint,
                editSubmit: endpoint,
                poll: {
                  path: 'jobs/{task_id}',
                  method: 'GET',
                  statusPath: 'status',
                  successValues: ['SUCCESS'],
                  failureValues: ['FAILURE'],
                  result: { b64JsonPaths: ['b64_json'] },
                },
              },
            ],
          },
        },
        version: 0,
      }),
    )
    sessionStorage.setItem(
      'amazon-image-studio-secrets',
      JSON.stringify({ profiles: { 'fixture-profile': 'test-only' } }),
    )
  })
  const requests: string[] = []
  let releasePoll!: () => void
  const waitForRelease = new Promise<void>((resolve) => {
    releasePoll = resolve
  })
  await page.route('https://isolation-api.test/**', async (route) => {
    const { pathname } = new URL(route.request().url())
    requests.push(pathname)
    if (pathname.endsWith('/submit')) return route.fulfill({ json: { task_id: 'new-edit' } })
    if (pathname.endsWith('/new-edit')) await waitForRelease
    await route.fulfill({ json: { status: 'SUCCESS', b64_json: PNG.toString('base64') } })
  })
  try {
    await page.goto('/#/editor')
    await page.reload()
    await page.waitForFunction(() => Boolean(window.releaseStartupCleanup))
    await page
      .locator('input[type=file]:not([multiple])')
      .setInputFiles({ name: 'source.png', mimeType: 'image/png', buffer: PNG })
    await page.locator('#seedream-instruction').fill('替换颜色')
    await page.getByText('开始图片编辑', { exact: true }).click()
    await expect.poll(() => requests).toEqual(['/v1/jobs/submit', '/v1/jobs/new-edit'])
    await page.evaluate(() => window.releaseStartupCleanup?.())
    await expect.poll(() => requests.includes('/v1/jobs/historic')).toBe(true)
    expect(requests).toEqual(['/v1/jobs/submit', '/v1/jobs/new-edit', '/v1/jobs/historic'])
  } finally {
    releasePoll()
  }
})

test('迟到的模型列表保留新增绑定，临时复用不会成为首页默认配置', async ({ page }) => {
  const defaultId = 'default-fixture'
  const reusedId = 'reused-fixture'
  await page.addInitScript(
    ({ defaultId, reusedId }) => {
      const settings = {
        activeProfileId: defaultId,
        reuseTaskApiProfileTemporarily: true,
        profiles: [defaultId, reusedId].map((id) => ({
          id,
          name: id,
          provider: 'openai',
          baseUrl: 'https://models-review.test/v1',
          model: id,
          apiMode: 'images',
          apiProxy: false,
        })),
      }
      localStorage.setItem('amazon-image-studio', JSON.stringify({ state: { settings }, version: 0 }))
      sessionStorage.setItem('amazon-image-studio-secrets', JSON.stringify({ profiles: { [reusedId]: 'test-only' } }))
    },
    { defaultId, reusedId },
  )
  let releaseModels!: () => void
  const waitForRelease = new Promise<void>((resolve) => {
    releaseModels = resolve
  })
  let modelRequested = false
  await page.route('**/models', async (route) => {
    modelRequested = true
    await waitForRelease
    await route.fulfill({ json: { data: [{ id: 'fixture-upstream-model' }] } })
  })
  try {
    await page.goto('/#/')
    await expect(page.getByRole('heading', { name: 'Amazon设计工作台' })).toBeVisible()
    await page.evaluate(updateStartupFixture, {
      tasks: [
        {
          ...fixtureTask,
          apiProvider: 'openai',
          apiProfileId: reusedId,
          outputImages: [`data:image/png;base64,${PNG.toString('base64')}`],
        },
      ],
      seed: true,
    })
    await page.reload()
    await page
      .getByRole('navigation', { name: '制作阶段' })
      .getByRole('button', { name: /筛选与导出/ })
      .click()
    await page.getByText('全部历史（含旧版及其他功能生成记录）', { exact: true }).click()
    const card = page.locator(`[data-task-id="${fixtureTask.id}"]`)
    await card.hover()
    await card.getByRole('button', { name: '复用配置', exact: true }).click()
    await page.getByRole('banner').getByRole('button', { name: '设置', exact: true }).click()
    await expect(page.getByTestId('api-model-input')).toHaveValue(reusedId)
    await page.getByText('获取模型列表', { exact: true }).click()
    await expect.poll(() => modelRequested).toBe(true)
    const binding = page.getByRole('combobox', { name: '通用编辑 API 配置' })
    await binding.selectOption(defaultId)
    releaseModels()
    await expect(page.getByText('获取模型列表', { exact: true })).toBeEnabled()
    await expect(binding).toHaveValue(defaultId)
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('amazon-image-studio')!).state.settings)
    expect(settings).toMatchObject({ activeProfileId: defaultId, imageEditorProfileId: defaultId })
    expect(settings.profiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: reusedId, availableModels: expect.arrayContaining(['fixture-upstream-model']) }),
      ]),
    )
  } finally {
    releaseModels()
  }
})

for (const workspace of ['sop', 'editor'] as const) {
  test(`${workspace} 重叠上传保留两批参考图且不会恢复已移除图片`, async ({ page }) => {
    await page.addInitScript(() => {
      const readAsDataURL = FileReader.prototype.readAsDataURL
      FileReader.prototype.readAsDataURL = function (file) {
        if (file instanceof File && file.name === 'delayed.png') {
          const onload = this.onload
          this.onload = (event) => {
            window.releaseUpload = () => onload?.call(this, event)
          }
        }
        return readAsDataURL.call(this, file)
      }
    })
    await page.goto(`/#/${workspace}`)
    const images = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const ctx = canvas.getContext('2d')!
      return ['red', 'blue', 'green'].map((color) => {
        ctx.fillStyle = color
        ctx.fillRect(0, 0, 1, 1)
        return canvas.toDataURL('image/png')
      })
    })
    const input = page.locator('input[type=file][multiple]')
    const upload = (name: string, index: number) =>
      input.setInputFiles({
        name,
        mimeType: 'image/png',
        buffer: Buffer.from(images[index].split(',')[1], 'base64'),
      })
    const references =
      workspace === 'sop' ? page.getByRole('button', { name: '移除图片' }) : page.getByTitle('移除', { exact: true })
    await upload('original.png', 0)
    await expect(references).toHaveCount(1)
    await upload('delayed.png', 1)
    await page.waitForFunction(() => Boolean(window.releaseUpload))
    await references.click()
    await upload('fast.png', 2)
    await expect(references).toHaveCount(1)
    await page.evaluate(() => window.releaseUpload?.())
    await expect(references).toHaveCount(2)
    if (workspace === 'sop') {
      await expect(page.getByAltText('fast.png')).toBeVisible()
      await expect(page.getByAltText('delayed.png')).toBeVisible()
      await expect(page.getByAltText('original.png')).toHaveCount(0)
      await page.evaluate(() => {
        delete window.releaseUpload
      })
      await upload('delayed.png', 0)
      await page.waitForFunction(() => Boolean(window.releaseUpload))
      await page.getByRole('button', { name: '重置表单' }).click()
      await page.evaluate(() => window.releaseUpload?.())
      await expect(references).toHaveCount(0)
    } else {
      await expect(page.getByAltText('参考图 1')).toHaveAttribute('src', images[2])
      await expect(page.getByAltText('参考图 2')).toHaveAttribute('src', images[1])
    }
  })
}
