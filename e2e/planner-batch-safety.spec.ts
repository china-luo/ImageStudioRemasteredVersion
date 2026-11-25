import { expect, test, type Page } from '@playwright/test'
import { ACTIVE_PROJECT_KEY, createGenerationProject, projectSlotId } from '../src/lib/generationProjects'
import { PLANNER_WORKSPACE_KEY } from '../src/components/planner/plannerWorkspaceDraft'
import { DEFAULT_PARAMS, type AmazonPlannerSession, type TaskRecord } from '../src/types'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLz4QAAAABJRU5ErkJggg=='
const API = /(?:https:\/\/planner-safety\.test\/|\/api-proxy\/https%3A%2F%2Fplanner-safety\.test)/

async function seed(page: Page, taskOverrides?: Partial<TaskRecord>) {
  const project = createGenerationProject()
  project.name = '策划提交安全回归'
  const workspace = project.workspace
  workspace.currentPlannerSessionId = '方案甲'
  workspace.listingText = '商品甲资料'
  workspace.draft.productTitle = '商品甲'
  workspace.selectedPlanIndex = 0
  workspace.imagePlans = ['MAIN', 'PT01'].map((slot) => ({
    slot,
    label: slot,
    prompt: 'A product on white.',
    negativePrompt: '',
    planMarkdown: '商品方案',
  }))
  workspace.styleCandidates = [
    { label: '风格甲', description: '简约风格', prompt: 'Minimal product style', negativePrompt: '' },
  ]
  workspace.styleImages = [{ candidateIndex: 0, status: 'done', imageId: '风格甲图片' }]
  workspace.selectedStyleIndex = 0
  const sessionA: AmazonPlannerSession = {
    ...workspace,
    id: '方案甲',
    title: '商品甲历史',
    platform: workspace.plannerPlatform,
    mode: workspace.plannerMode,
    referenceImageIds: [],
    styleImages: [{ candidateIndex: 0, imageId: '风格甲图片' }],
    createdAt: 1,
    updatedAt: 1,
  }
  const sessionB: AmazonPlannerSession = {
    ...sessionA,
    id: '方案乙',
    title: '商品乙历史',
    listingText: '商品乙资料',
    draft: { ...sessionA.draft, productTitle: '商品乙' },
    styleCandidates: [{ label: '风格乙', description: '商品乙风格', prompt: 'Product B style', negativePrompt: '' }],
    styleImages: [{ candidateIndex: 0, imageId: '风格乙图片' }],
  }
  const tasks: TaskRecord[] = taskOverrides
    ? [
        {
          id: '已有任务',
          prompt: '',
          params: DEFAULT_PARAMS,
          inputImageIds: [],
          outputImages: [],
          status: 'error',
          error: '终态失败',
          createdAt: 1,
          finishedAt: 2,
          elapsed: 1,
          category: {
            projectId: project.id,
            projectSlotId: projectSlotId(workspace, 'MAIN'),
            amazonSlot: 'MAIN',
            workflow: 'amazon-listing',
          },
          ...taskOverrides,
        },
      ]
    : []
  await page.goto('/manifest.webmanifest')
  await page.evaluate(
    async ({ project, sessions, tasks, png, activeKey }) => {
      const profile = {
        id: '安全测试配置',
        name: '安全测试配置',
        provider: 'openai',
        apiKey: '',
        timeout: 60,
        codexCli: false,
        baseUrl: 'https://planner-safety.test/v1',
        model: 'gpt-image-2',
        apiMode: 'images',
        apiProxy: false,
      }
      localStorage.setItem(
        'amazon-image-studio',
        JSON.stringify({
          state: {
            settings: {
              profiles: [profile],
              activeProfileId: profile.id,
              clearInputAfterSubmit: false,
            },
          },
          version: 0,
        }),
      )
      sessionStorage.setItem(
        'amazon-image-studio-secrets',
        JSON.stringify({ apiKey: 'test-only-placeholder', profiles: { [profile.id]: 'test-only-placeholder' } }),
      )
      sessionStorage.setItem(activeKey, project.id)
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('amazon-image-studio', 5)
        request.onupgradeneeded = () => {
          for (const name of ['tasks', 'images', 'thumbnails', 'amazonPlannerSessions', 'generationProjects'])
            request.result.createObjectStore(name, { keyPath: 'id' })
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['generationProjects', 'images', 'tasks', 'amazonPlannerSessions'], 'readwrite')
        tx.objectStore('generationProjects').put(project)
        for (const session of sessions) tx.objectStore('amazonPlannerSessions').put(session)
        for (const task of tasks) tx.objectStore('tasks').put(task)
        for (const id of ['风格甲图片', '风格乙图片'])
          tx.objectStore('images').put({
            id,
            dataUrl: `data:image/png;base64,${png}`,
            source: 'generated',
            createdAt: 1,
          })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      })
    },
    { project, sessions: [sessionA, sessionB], tasks, png: PNG, activeKey: ACTIVE_PROJECT_KEY },
  )
  // 测试仅允许本地资源，外部生图与恢复查询全部由本地路由接管。
  await page.route(API, (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [{ b64_json: PNG }] }) }),
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
async function rows<T>(page: Page, store: string): Promise<T[]> {
  return page.evaluate(
    (store) =>
      new Promise<T[]>((resolve, reject) => {
        const open = indexedDB.open('amazon-image-studio')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const request = db.transaction(store).objectStore(store).getAll()
          request.onsuccess = () => {
            db.close()
            resolve(request.result)
          }
          request.onerror = () => reject(request.error)
        }
      }),
    store,
  )
}
async function workspace(page: Page) {
  return page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)!), PLANNER_WORKSPACE_KEY)
}
async function restoreB(page: Page) {
  await page.getByRole('button', { name: /策划历史/ }).click()
  await page
    .getByText('商品乙历史', { exact: true })
    .locator('..')
    .locator('..')
    .locator('..')
    .getByRole('button', { name: '恢复', exact: true })
    .click()
  await expect.poll(async () => (await workspace(page)).listingText).toBe('商品乙资料')
}

test('changing product facts prevents single and batch from using a stale plan', async ({ page }) => {
  await seed(page)
  const listing = page.getByRole('textbox', { name: '标题 / 五点描述', exact: true })
  await listing.fill('商品乙的新资料')
  await stage(page, '图片制作')
  await expect(page.getByRole('button', { name: '提交生成', exact: true })).toBeDisabled()
  await expect(page.getByRole('complementary', { name: '生成操作与设置' })).toContainText('商品资料或参考图顺序已变化。')
  await page.getByRole('button', { name: '全选', exact: true }).click()
  await expect(page.getByRole('button', { name: /^批量生成/ })).toBeDisabled()
  expect(await rows(page, 'tasks')).toHaveLength(0)
  await stage(page, '商品资料')
  await listing.fill('商品甲资料')
  await stage(page, '图片制作')
  await expect(page.getByRole('button', { name: '提交生成', exact: true })).toBeEnabled()
})

test('request preview includes the edited prompt, actual pixel target, and final attachments', async ({ page }) => {
  await seed(page)
  await stage(page, '图片制作')
  await page.getByRole('button', { name: '提示词', exact: true }).click()
  await page.locator('textarea[spellcheck="false"]:visible').fill('Show the stainless steel lid.')
  await page.getByRole('button', { name: '保存提示词', exact: true }).click()
  await page.getByText('生图请求预览（含提示词与参考图顺序）', { exact: true }).click()
  const preview = page.locator('details[open]').filter({ hasText: '生图请求预览' })
  await expect(preview).toContainText('Mandatory Amazon MAIN image rules')
  await expect(preview).toContainText('Show the stainless steel lid.')
  await expect(preview).toContainText('expected image resolution 2048x2048 px')
  await expect(preview).toContainText('附件：无')
  const wire = page.waitForRequest((request) => API.test(request.url()) && request.method() === 'POST')
  await page.getByRole('button', { name: '提交生成', exact: true }).click()
  const body = (await wire).postDataJSON()
  expect(body.prompt).toBe(await preview.locator('pre').textContent())
  expect(body.size).toBe('2048x2048')
})

test('选失败为空及手动清空都不回退全选，显式全选仍可提交', async ({ page }) => {
  await seed(page)
  await stage(page, '图片制作')
  const batch = page.getByRole('button', { name: /^批量生成/ })
  await page.getByRole('button', { name: '选失败', exact: true }).click()
  await expect(batch).toBeDisabled()
  for (const checkbox of await page.getByRole('checkbox', { name: /批量生成/ }).all())
    await expect(checkbox).not.toBeChecked()
  expect(await rows(page, 'tasks')).toHaveLength(0)
  await page.getByRole('button', { name: '全选', exact: true }).click()
  await page.getByRole('button', { name: '清空', exact: true }).click()
  await expect(batch).toBeDisabled()
  await page.getByRole('button', { name: '全选', exact: true }).click()
  await batch.click()
  await expect.poll(async () => (await rows(page, 'tasks')).length).toBe(2)
})

test('暂停查询既不能单张重提，也不属于选失败；批量跳过原任务', async ({ page }) => {
  await seed(page, { customTaskId: '远端任务', customRecoverable: true, recoveryPausedReason: 'timeout' })
  await stage(page, '图片制作')
  await expect(page.getByRole('button', { name: '生成中…', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '选失败', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: '选择 MAIN 批量生成', exact: true })).not.toBeChecked()
  await page.getByRole('button', { name: '全选', exact: true }).click()
  await page.getByRole('button', { name: /^批量生成/ }).click()
  await expect.poll(async () => (await rows<TaskRecord>(page, 'tasks')).length).toBe(2)
  const tasks = await rows<TaskRecord>(page, 'tasks')
  expect(tasks.filter((task) => task.category?.amazonSlot === 'MAIN')).toHaveLength(1)
  expect(tasks.filter((task) => task.category?.amazonSlot === 'PT01')).toHaveLength(1)
})

for (const first of ['single', 'batch'] as const) {
  test(`同一轮事件${first === 'single' ? '单张先于批量' : '批量先于单张'}只接受一次提交，运行中不能重复`, async ({
    page,
  }) => {
    await seed(page)
    await stage(page, '图片制作')
    await page.getByRole('checkbox', { name: '选择 MAIN 批量生成', exact: true }).check()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route(API, async (route) => {
      await gate
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [{ b64_json: PNG }] }) })
    })
    try {
      const request = page.waitForRequest(API)
      await page.evaluate((first) => {
        const buttons = [...document.querySelectorAll('button')]
        const single = buttons.find((button) => button.textContent?.trim() === '提交生成')!
        const batch = buttons.find((button) => button.textContent?.trim() === '批量生成 1')!
        if (first === 'single') {
          single.click()
          batch.click()
        } else {
          batch.click()
          single.click()
        }
      }, first)
      await request
      await expect.poll(async () => (await rows(page, 'tasks')).length).toBe(1)
      await expect(page.getByRole('button', { name: '生成中…', exact: true })).toBeDisabled()
      await page.getByRole('checkbox', { name: '选择 MAIN 批量生成', exact: true }).check()
      await page.getByRole('button', { name: /^批量生成/ }).click()
      await expect(page.getByText('已提交 0 个图片任务', { exact: true })).toBeVisible()
      expect(await rows(page, 'tasks')).toHaveLength(1)
    } finally {
      release()
    }
    await expect(page.getByRole('button', { name: '生成新版本', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '生成新版本', exact: true }).click()
    await expect.poll(async () => (await rows(page, 'tasks')).length).toBe(2)
  })
}

test('恢复历史重置批量选择，迟到风格板不能混入新方案或改写当前方案 ID', async ({ page }) => {
  await seed(page)
  await stage(page, '图片制作')
  await page.getByRole('button', { name: '全选', exact: true }).click()
  await stage(page, '策划与风格')
  // 模拟供应商忽略取消，响应依然迟到返回。
  await page.evaluate(() => {
    const fetchImpl = window.fetch
    window.fetch = (input, init) =>
      String(input).includes('planner-safety.test')
        ? fetchImpl(input, { ...init, signal: undefined })
        : fetchImpl(input, init)
  })
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(API, async (route) => {
    await gate
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [{ b64_json: PNG }] }) })
  })
  try {
    await page.getByRole('button', { name: '生成风格板', exact: true }).click()
    const request = page.waitForRequest(API)
    await page.getByRole('button', { name: '开始生成', exact: true }).click()
    await request
    await restoreB(page)
    const response = page.waitForResponse(API)
    release()
    await response
    await expect.poll(async () => (await workspace(page)).currentPlannerSessionId).toBe('方案乙')
    expect((await workspace(page)).styleImages).toEqual([{ candidateIndex: 0, status: 'done', imageId: '风格乙图片' }])
    await stage(page, '图片制作')
    await expect(page.getByRole('button', { name: /^批量生成/ })).toBeDisabled()
    const histories = await rows<AmazonPlannerSession>(page, 'amazonPlannerSessions')
    expect(histories.find((session) => session.id === '方案乙')?.styleImages).toEqual([
      { candidateIndex: 0, imageId: '风格乙图片' },
    ])
  } finally {
    release()
  }
})

test('删除当前历史不改变图片位身份或隐藏版本，后续编辑及重载不会复活历史', async ({ page }) => {
  await seed(page, { status: 'done', error: null, outputImages: ['风格甲图片'] })
  await stage(page, '图片制作')
  const versions = page.getByRole('region', { name: '当前图片位版本', exact: true })
  await expect(versions.getByText('已完成', { exact: true })).toHaveCount(1)
  await page.getByRole('button', { name: /策划历史/ }).click()
  await page
    .getByText('商品甲历史', { exact: true })
    .locator('..')
    .locator('..')
    .locator('..')
    .getByRole('button', { name: '删除', exact: true })
    .click()
  await expect(page.getByText('策划历史已删除', { exact: true })).toBeVisible()
  await expect(versions.getByText('已完成', { exact: true })).toHaveCount(1)
  expect((await workspace(page)).currentPlannerSessionId).toBe('方案甲')
  await page.getByRole('button', { name: '收起', exact: true }).click()
  // 选择另一图片位会触发历史更新，但已删除的历史不能再次写入。
  await page.getByRole('button', { name: /PT01 PT01/ }).click()
  await page.getByRole('button', { name: /MAIN MAIN/ }).click()
  expect(
    (await rows<AmazonPlannerSession>(page, 'amazonPlannerSessions')).some((session) => session.id === '方案甲'),
  ).toBe(false)
  await page.reload()
  await stage(page, '图片制作')
  await expect(versions.getByText('已完成', { exact: true })).toHaveCount(1)
  expect((await workspace(page)).currentPlannerSessionId).toBe('方案甲')
  expect(
    (await rows<AmazonPlannerSession>(page, 'amazonPlannerSessions')).some((session) => session.id === '方案甲'),
  ).toBe(false)
})
