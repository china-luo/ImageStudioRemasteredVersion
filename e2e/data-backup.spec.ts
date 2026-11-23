import { expect, test, type Page } from '@playwright/test'
import { strToU8, zipSync } from 'fflate'
import { createGenerationProject } from '../src/lib/generationProjects'
import { DEFAULT_PARAMS, type ExportData, type TaskRecord } from '../src/types'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWm0AAAAASUVORK5CYII=',
  'base64',
)

const manifest = (data: Partial<ExportData>) => ({ version: 5, exportedAt: new Date(0).toISOString(), ...data })

test.beforeEach(async ({ page }) => {
  // 备份流程不依赖外部字体，避免 CDN 响应拖住页面加载。
  await page.route(/^https:\/\/(fontsapi\.zeoseven\.com|cdn\.jsdelivr\.net)\//, (route) => route.abort())
})

function readData({ store, id }: { store: string; id?: string }) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('amazon-image-studio')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction(store)
      const rows = id ? tx.objectStore(store).get(id) : tx.objectStore(store).getAll()
      tx.oncomplete = () => {
        db.close()
        resolve(rows.result)
      }
      tx.onabort = () => {
        db.close()
        reject(tx.error)
      }
    }
  })
}

async function openDataSettings(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '数据管理', exact: true }).click()
}

async function uploadBackup(page: Page, data: ExportData, files: Record<string, Uint8Array> = {}) {
  const buffer = Buffer.from(zipSync({ 'manifest.json': strToU8(JSON.stringify(data)), ...files }))
  await page
    .locator('input[type=file][accept=".zip"]')
    .setInputFiles({ name: 'backup.zip', mimeType: 'application/zip', buffer })
}

test('旧备份不覆盖已有项目，写入失败不会留下半份备份', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: '项目名称' })).toBeVisible()
  await openDataSettings(page)
  const project = { ...createGenerationProject(), name: '较新的本地项目' }
  const newProject = { ...createGenerationProject(), name: '备份独有项目' }
  await uploadBackup(page, manifest({ generationProjects: [project] }))
  await expect
    .poll(() => page.evaluate(readData, { store: 'generationProjects', id: project.id }))
    .toMatchObject({
      name: project.name,
      revision: 1,
    })
  await uploadBackup(page, manifest({ generationProjects: [{ ...project, name: '旧项目', revision: 10 }, newProject] }))
  await expect(page.getByText(/已保留 1 条同 ID 的本地数据/)).toBeVisible()
  expect(await page.evaluate(readData, { store: 'generationProjects', id: project.id })).toMatchObject({
    name: project.name,
    revision: 1,
  })
  expect(await page.evaluate(readData, { store: 'generationProjects', id: newProject.id })).toMatchObject({
    name: newProject.name,
  })

  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add
    IDBObjectStore.prototype.add = function (value, key) {
      const result = add.call(this, value, key)
      if (this.name === 'tasks' && value?.id === 'abort-backup-task') {
        result.addEventListener('success', () => this.transaction.abort(), { once: true })
      }
      return result
    }
  })
  await uploadBackup(
    page,
    manifest({
      imageFiles: { 'rollback-image': { path: 'images/test.png' } },
      tasks: [
        {
          id: 'abort-backup-task',
          prompt: 'fixture',
          params: DEFAULT_PARAMS,
          inputImageIds: [],
          outputImages: ['rollback-image'],
          status: 'done',
          error: null,
          createdAt: 1,
          finishedAt: 2,
          elapsed: 1,
        },
      ],
    }),
    { 'images/test.png': PNG },
  )
  await expect(page.getByText(/导入失败/)).toBeVisible()
  expect(await page.evaluate(readData, { store: 'images', id: 'rollback-image' })).toBeUndefined()
  expect(await page.evaluate(readData, { store: 'tasks', id: 'abort-backup-task' })).toBeUndefined()
})

test('导入后中断普通在途任务；远端任务仅续查，清空回滚后继续查同一个 ID', async ({ page }) => {
  const provider = 'backup-job-provider'
  const profileId = 'backup-job-profile'
  await page.addInitScript(
    ({ provider, profileId }) => {
      const profile = {
        id: profileId,
        name: '回归测试配置',
        provider,
        baseUrl: 'https://backup-api.test/v1',
        apiMode: 'images',
        model: 'mock-image',
        timeout: 60,
        codexCli: false,
        apiProxy: false,
      }
      localStorage.setItem(
        'amazon-image-studio',
        JSON.stringify({
          state: {
            settings: {
              profiles: [profile],
              activeProfileId: profileId,
              customProviders: [
                {
                  id: provider,
                  name: '回归测试服务商',
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
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(/https:\/\/backup-api\.test\/|\/api-proxy\//, async (route) => {
    const request = route.request()
    requests.push(`${request.method()} ${new URL(request.url()).pathname}`)
    // 等断言确认清空失败后才返回，避免恢复成功的提示覆盖失败提示。
    await held
    await route.fulfill({ json: { status: 'SUCCESS', b64_json: PNG.toString('base64') } }).catch(() => {})
  })
  await page.goto('/')
  await openDataSettings(page)
  const localTask: TaskRecord = {
    id: 'local-running',
    prompt: '回归测试任务',
    params: DEFAULT_PARAMS,
    inputImageIds: [],
    outputImages: [],
    status: 'running',
    error: null,
    createdAt: 1,
    finishedAt: null,
    elapsed: null,
  }
  const remoteTask: TaskRecord = {
    ...localTask,
    id: 'remote-running',
    apiProvider: provider,
    apiProfileId: profileId,
    customTaskId: 'same-remote-id',
  }
  try {
    await uploadBackup(page, manifest({ tasks: [localTask, remoteTask] }))
    await expect(page.getByText('已导入 2 条记录', { exact: true })).toBeVisible()
    expect(await page.evaluate(readData, { store: 'tasks', id: localTask.id })).toMatchObject({
      status: 'error',
      error: '请求中断',
    })
    await expect.poll(() => requests).toEqual(['GET /v1/jobs/same-remote-id'])
    await page.evaluate(() => {
      const clear = IDBObjectStore.prototype.clear
      IDBObjectStore.prototype.clear = function () {
        const request = clear.call(this)
        if (this.name === 'tasks') request.addEventListener('success', () => this.transaction.abort(), { once: true })
        return request
      }
    })
    await page.getByRole('button', { name: '清空所选数据', exact: true }).click()
    await page.getByRole('button', { name: '确认清空', exact: true }).click()
    await expect(page.getByText(/清空失败/)).toBeVisible()
    await expect.poll(() => requests).toEqual(['GET /v1/jobs/same-remote-id', 'GET /v1/jobs/same-remote-id'])
    release()
    await expect
      .poll(() => page.evaluate(readData, { store: 'tasks', id: remoteTask.id }))
      .toMatchObject({
        status: 'done',
        customTaskId: 'same-remote-id',
        outputImages: [expect.any(String)],
      })
    expect(requests).toEqual(['GET /v1/jobs/same-remote-id', 'GET /v1/jobs/same-remote-id'])
  } finally {
    release()
  }
})

test('清空任务和图片时同步重置编辑器草稿', async ({ page }) => {
  await page.goto('/#/editor')
  await page
    .locator('input[type=file]:not([multiple])')
    .setInputFiles({ name: 'source.png', mimeType: 'image/png', buffer: PNG })
  const readDraft = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('amazon-image-studio') ?? '{}').state?.seedreamEditorDraft)
  await expect.poll(async () => (await readDraft())?.sourceImageId).toBeTruthy()
  const { sourceImageId } = await readDraft()
  expect(await page.evaluate(readData, { store: 'images', id: sourceImageId })).toBeTruthy()
  await openDataSettings(page)
  await page.getByRole('button', { name: '清空所选数据', exact: true }).click()
  await page.getByRole('button', { name: '确认清空', exact: true }).click()
  await expect(page.getByText('所选数据已清空')).toBeVisible()
  await expect
    .poll(readDraft)
    .toMatchObject({ sourceImageId: null, referenceImageIds: [], instruction: '', latestTaskId: null })
  expect(await page.evaluate(readData, { store: 'images', id: sourceImageId })).toBeUndefined()
})
