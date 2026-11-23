import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyPlannerWorkspace } from './plannerWorkspaceDraft'
import { createPlannerSessionSnapshot } from './plannerHelpers'
import type { AmazonPlannerSession } from '../../types'

const hooks = vi.hoisted(() => ({ refs: [] as Array<{ current: unknown }>, index: 0 }))
const db = vi.hoisted(() => ({ put: vi.fn(), remove: vi.fn() }))
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useRef: (initial: unknown) => hooks.refs[hooks.index++] ?? (hooks.refs[hooks.index - 1] = { current: initial }),
  useCallback: (callback: unknown) => callback,
}))
vi.mock('../../lib/db', () => ({ putAmazonPlannerSession: db.put, deleteAmazonPlannerSession: db.remove }))
import { useAmazonPlannerController, type PlannerControllerSnapshot } from './useAmazonPlannerController'

function fixture() {
  const workspace = createEmptyPlannerWorkspace()
  workspace.currentPlannerSessionId = '方案甲'
  const session = createPlannerSessionSnapshot({ ...workspace, referenceImageIds: [] })
  let sessions = [session]
  const setSessions = (update: (current: AmazonPlannerSession[]) => AmazonPlannerSession[]) => {
    sessions = update(sessions)
  }
  const toast = vi.fn()
  const snapshot: PlannerControllerSnapshot = { ...workspace, plannerSessions: sessions, referenceImageIds: [] }
  const render = (next = snapshot) => {
    hooks.index = 0
    return useAmazonPlannerController(next, setSessions, toast)
  }
  return { render, snapshot, session, sessions: () => sessions }
}

beforeEach(() => {
  hooks.refs = []
  hooks.index = 0
  db.put.mockReset().mockResolvedValue(undefined)
  db.remove.mockReset().mockResolvedValue(undefined)
})

describe('策划历史保存与删除隔离', () => {
  it('切换历史后旧回调不能继续更新旧方案', async () => {
    const fixtureState = fixture()
    const old = fixtureState.render()
    fixtureState.render({ ...fixtureState.snapshot, currentPlannerSessionId: '方案乙' })
    old.updateCurrentPlannerSession({ styleDensityMode: 'minimal' })
    await Promise.resolve()
    expect(db.put).not.toHaveBeenCalled()
  })

  it('历史不存在时保留项目方案 ID，但无关编辑不会重建历史', async () => {
    const { render, snapshot } = fixture()
    const controller = render({ ...snapshot, plannerSessions: [] })
    controller.updateCurrentPlannerSession({ selectedPlanIndex: 1 })
    await Promise.resolve()
    expect(db.put).not.toHaveBeenCalled()
    expect(snapshot.currentPlannerSessionId).toBe('方案甲')
  })

  it('删除等待在途写入，封禁后续旧回调，最终数据库和列表均不复活', async () => {
    const { render, snapshot, sessions } = fixture()
    const controller = render()
    let release!: () => void
    db.put.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const saving = controller.savePlannerSession({ styleDensityMode: 'minimal' })
    await vi.waitFor(() => expect(db.put).toHaveBeenCalledTimes(1))
    const removing = controller.deletePlannerSessionHistory('方案甲')
    controller.updateCurrentPlannerSession({ selectedPlanIndex: 1 })
    expect(db.remove).not.toHaveBeenCalled()
    release()
    await Promise.all([saving, removing])
    expect(db.remove).toHaveBeenCalledWith('方案甲')
    expect(db.put).toHaveBeenCalledTimes(1)
    expect(sessions()).toEqual([])
    expect(snapshot.currentPlannerSessionId).toBe('方案甲')
    controller.updateCurrentPlannerSession({ selectedPlanIndex: 0 })
    await Promise.resolve()
    expect(db.put).toHaveBeenCalledTimes(1)
  })

  it('同一历史保存顺序与发起顺序一致', async () => {
    const { render } = fixture()
    const controller = render()
    let release!: () => void
    db.put.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const first = controller.savePlannerSession({ selectedPlanIndex: 1 })
    const second = controller.savePlannerSession({ selectedPlanIndex: 2 })
    await vi.waitFor(() => expect(db.put).toHaveBeenCalledTimes(1))
    release()
    await Promise.all([first, second])
    expect(db.put.mock.calls.map(([session]) => session.selectedPlanIndex)).toEqual([1, 2])
  })
})
