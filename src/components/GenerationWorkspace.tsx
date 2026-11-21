import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { GenerationProject } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { getAllGenerationProjects, putGenerationProject } from '../lib/db'
import {
  readActiveProjectId,
  rememberActiveProject,
  PROJECT_DATA_EVENT,
  PROJECT_JOURNAL_KEY,
  PROJECT_WRITER_KEY,
  readProjectJournal,
  canSelectProjectFinal,
  createGenerationProject,
  persistableProjectWorkspace,
  projectSnapshotSignature,
} from '../lib/generationProjects'
import { ensureImageCached, useStore } from '../store'
import {
  readPlannerWorkspaceDraft,
  savePlannerWorkspaceDraft,
  type PlannerWorkspaceDraft,
} from './planner/plannerWorkspaceDraft'
import AmazonPlanner from './AmazonPlanner'
import InputBar from './InputBar'

export default function GenerationWorkspace(props: { resultsPanel: ReactNode }) {
  const [project, setProject] = useState<GenerationProject | null>(null)
  const [projects, setProjects] = useState<GenerationProject[]>([])
  const [status, setStatus] = useState('正在加载项目…')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [reload, setReload] = useState(0)
  const active = useRef<GenerationProject | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const revisions = useRef(new Map<string, number>())
  const epoch = useRef(0)
  const saveError = useRef('')
  const inputPrompt = useStore((state) => state.prompt)
  const inputParams = useStore((state) => state.params)
  const [writerId] = useState(() => {
    const id = sessionStorage.getItem(PROJECT_WRITER_KEY) ?? crypto.randomUUID()
    sessionStorage.setItem(PROJECT_WRITER_KEY, id)
    return id
  })

  const save = useCallback(
    (next: GenerationProject) => {
      next = {
        ...next,
        writerId,
        revision: revisions.current.get(next.id) ?? 0,
        updatedAt: Math.max(Date.now(), (active.current?.updatedAt ?? 0) + 1),
      }
      try {
        sessionStorage.setItem(PROJECT_JOURNAL_KEY, JSON.stringify(next))
      } catch {
        /* IndexedDB still saves the project. */
      }
      active.current = next
      setProject(next)
      setStatus('正在保存…')
      const generation = epoch.current
      queue.current = queue.current.then(async () => {
        if (generation !== epoch.current || saveError.current) return
        try {
          const revision = await putGenerationProject(next, revisions.current.get(next.id) ?? 0)
          revisions.current.set(next.id, revision)
          if (generation !== epoch.current) return
          if (active.current?.id === next.id) {
            active.current = { ...active.current, revision }
            try {
              sessionStorage.setItem(PROJECT_JOURNAL_KEY, JSON.stringify(active.current))
            } catch {
              /* Durable save succeeded. */
            }
          }
          setProjects((items) => [{ ...next, revision }, ...items.filter((item) => item.id !== next.id)])
          setStatus('已自动保存')
        } catch (cause) {
          if (generation !== epoch.current) return
          saveError.current = cause instanceof Error ? cause.message : String(cause)
          setError(saveError.current)
          setStatus('保存失败')
        }
      })
    },
    [writerId],
  )

  useEffect(() => {
    ++epoch.current
    let canceled = false
    active.current = null
    saveError.current = ''
    setError('')
    setProject(null)
    void (async () => {
      const all = await getAllGenerationProjects()
      if (canceled) return
      setProjects(all)
      revisions.current = new Map(all.map((item) => [item.id, item.revision]))
      const activeProjectId = readActiveProjectId()
      const selected = all.find((item) => item.id === activeProjectId)
      const journal = readProjectJournal()
      const pending = journal?.id === activeProjectId ? journal : null
      const pendingIsNewer = pending && (!selected || pending.updatedAt > selected.updatedAt)
      const next = pendingIsNewer
        ? { ...pending, revision: 0 }
        : (selected ??
          createGenerationProject(
            readPlannerWorkspaceDraft(),
            useStore.getState().inputImages.map((image) => image.id),
          ))
      if (pendingIsNewer && selected && selected.writerId !== writerId && selected.revision !== pending.revision) {
        revisions.current.set(next.id, pending.revision)
      }
      // Normalizes interrupted style requests without duplicating image bytes.
      savePlannerWorkspaceDraft(next.workspace)
      next.workspace = readPlannerWorkspaceDraft()
      if (selected || pending) {
        const images = await Promise.all(
          next.referenceImageIds.map(async (id) => ({ id, dataUrl: await ensureImageCached(id) })),
        )
        if (canceled) return
        useStore
          .getState()
          .setInputImages(images.flatMap((image) => (image.dataUrl ? [{ id: image.id, dataUrl: image.dataUrl }] : [])))
        if (images.some((image) => !image.dataUrl))
          useStore.getState().showToast('部分项目参考图已丢失，请重新上传。', 'error')
        useStore.getState().setPrompt(next.inputDraft?.prompt ?? '')
        useStore.getState().setParams(next.inputDraft?.params ?? DEFAULT_PARAMS)
      }
      if (canceled) return
      rememberActiveProject(next.id)
      active.current = next
      setProject(next)
      setStatus(selected ? '已自动保存' : '新项目')
      setBusy(false)
    })().catch((cause) => {
      if (!canceled) setError(`项目加载失败：${String(cause)}`)
    })
    return () => {
      canceled = true
    }
  }, [reload, writerId])

  useEffect(() => {
    const refresh = () => {
      epoch.current++
      active.current = null
      sessionStorage.removeItem(PROJECT_JOURNAL_KEY)
      setReload((value) => value + 1)
    }
    window.addEventListener(PROJECT_DATA_EVENT, refresh)
    return () => window.removeEventListener(PROJECT_DATA_EVENT, refresh)
  }, [])

  useEffect(() => {
    const current = active.current
    if (!current || switching) return
    const inputDraft = { prompt: inputPrompt, params: inputParams }
    if (
      projectSnapshotSignature(current.inputDraft ?? { prompt: '', params: DEFAULT_PARAMS }) !==
      projectSnapshotSignature(inputDraft)
    )
      save({ ...current, inputDraft })
  }, [inputPrompt, inputParams, project?.id, switching, save])

  const onWorkspaceChange = useCallback(
    (workspace: PlannerWorkspaceDraft, referenceImageIds: string[]) => {
      const current = active.current
      if (!current) return
      const nextWorkspace = persistableProjectWorkspace(workspace)
      if (
        current.revision > 0 &&
        projectSnapshotSignature([current.workspace, current.referenceImageIds]) ===
          projectSnapshotSignature([nextWorkspace, referenceImageIds])
      )
        return
      save({
        ...current,
        workspace: nextWorkspace,
        referenceImageIds,
        updatedAt: Date.now(),
        revision: revisions.current.get(current.id) ?? 0,
      })
    },
    [save],
  )

  const switchProject = async (id?: string) => {
    if (busy || switching) return
    setSwitching(true)
    try {
      await queue.current
      if (saveError.current) throw new Error(saveError.current)
      const all = await getAllGenerationProjects()
      const next = id ? all.find((item) => item.id === id) : createGenerationProject()
      if (!next) throw new Error('项目不存在，请重新加载项目列表。')
      const images = await Promise.all(
        next.referenceImageIds.map(async (imageId) => ({ id: imageId, dataUrl: await ensureImageCached(imageId) })),
      )
      if (images.some((image) => !image.dataUrl)) throw new Error('项目参考图缺失，请先从备份恢复图片。')
      savePlannerWorkspaceDraft(next.workspace)
      next.workspace = readPlannerWorkspaceDraft()
      const state = useStore.getState()
      state.setInputImages(images.map((image) => ({ id: image.id, dataUrl: image.dataUrl! })))
      state.setPrompt(next.inputDraft?.prompt ?? '')
      state.setParams(next.inputDraft?.params ?? DEFAULT_PARAMS)
      state.setPendingTaskCategory(null)
      state.clearMaskDraft()
      state.clearSelection()
      rememberActiveProject(next.id)
      revisions.current.set(next.id, next.revision)
      setProjects(all)
      active.current = next
      setProject(next)
      setStatus('已自动保存')
    } catch (cause) {
      useStore.getState().showToast(String(cause), 'error')
    } finally {
      setSwitching(false)
    }
  }

  const onFinalChange = useCallback(
    (slotId: string, taskId: string | null, imageId?: string) => {
      const current = active.current
      if (!current) return
      const finals = { ...current.finals }
      if (taskId && imageId) {
        const task = useStore.getState().tasks.find((item) => item.id === taskId)
        if (!task || task.category?.projectSlotId !== slotId || !canSelectProjectFinal(current, task, imageId)) return
        finals[slotId] = { taskId, imageId }
      } else delete finals[slotId]
      save({ ...current, finals, updatedAt: Date.now() })
    },
    [save],
  )

  if (!project)
    return (
      <div className="planner-empty" role="status">
        {error || '正在加载项目…'}
        {error && <button onClick={() => setReload((n) => n + 1)}>重试加载</button>}
      </div>
    )

  return (
    <>
      <section className="project-toolbar" aria-label="商品项目" data-no-drag-select>
        <label>
          切换项目
          <select
            aria-label="切换项目"
            value={project.id}
            disabled={busy || switching || Boolean(error)}
            onChange={(event) => void switchProject(event.target.value)}
          >
            {[project, ...projects.filter((item) => item.id !== project.id)].map((item) => (
              <option key={item.id} value={item.id}>
                {item.name || '未命名项目'} · {item.id.slice(0, 6)}
              </option>
            ))}
          </select>
        </label>
        <label>
          项目名称
          <input
            aria-label="项目名称"
            value={project.name}
            maxLength={100}
            disabled={switching || Boolean(error)}
            onChange={(event) => save({ ...active.current!, name: event.target.value, updatedAt: Date.now() })}
          />
        </label>
        <button type="button" disabled={busy || switching || Boolean(error)} onClick={() => void switchProject()}>
          新建项目
        </button>
        <span role="status" className="text-xs text-gray-500">
          {busy ? '当前操作完成后可切换项目' : status}
        </span>
        {error && (
          <div role="alert" className="w-full text-sm text-red-600">
            {error}
            <button
              type="button"
              onClick={() => {
                // Keep the unsaved work as a new project when storage is available again.
                const copy = {
                  ...active.current!,
                  id: crypto.randomUUID(),
                  revision: 0,
                  finals: {},
                  name: `${active.current!.name}（恢复副本）`,
                }
                saveError.current = ''
                setError('')
                rememberActiveProject(copy.id)
                save(copy)
              }}
            >
              另存恢复副本
            </button>
          </div>
        )}
      </section>
      <fieldset className="min-w-0" disabled={switching || Boolean(error)}>
        <AmazonPlanner
          key={project.id}
          {...props}
          generationPanel={<InputBar inline projectId={project.id} />}
          project={project}
          onWorkspaceChange={onWorkspaceChange}
          onBusyChange={setBusy}
          onFinalChange={onFinalChange}
        />
      </fieldset>
    </>
  )
}
