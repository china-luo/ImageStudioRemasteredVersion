import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { GenerationProject, InputImage } from '../types'
import { DEFAULT_PARAMS } from '../types'
import { getAllGenerationProjects, putGenerationProject } from '../lib/db'
import {
  readActiveProjectId,
  rememberActiveProject,
  PROJECT_DATA_EVENT,
  PROJECT_DATA_IMPORTED_EVENT,
  PROJECT_DATA_RESET_EVENT,
  PROJECT_JOURNAL_KEY,
  PROJECT_WRITER_KEY,
  readProjectJournal,
  canSelectProjectFinal,
  createGenerationProject,
  createProjectId,
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
import { FolderIcon, PlusIcon } from './icons'

async function readProjectReferences(ids: string[]) {
  const entries = await Promise.all(ids.map(async (id) => ({ id, dataUrl: await ensureImageCached(id) })))
  return {
    available: entries.flatMap(({ id, dataUrl }) => (dataUrl ? [{ id, dataUrl }] : [])),
    missing: entries.filter(({ dataUrl }) => !dataUrl).map(({ id }) => id),
  }
}

// 未加载的参考图保留其位置；可见参考图仍遵循用户调整后的顺序。
function withMissingReferences(previous: string[], visible: string[], missing: string[]) {
  const merged = [...visible]
  const missingSet = new Set(missing)
  previous.forEach((id, index) => {
    if (missingSet.has(id) && !merged.includes(id)) merged.splice(index, 0, id)
  })
  return merged
}

export default function GenerationWorkspace(props: { resultsPanel: ReactNode }) {
  const [project, setProject] = useState<GenerationProject | null>(null)
  const [projects, setProjects] = useState<GenerationProject[]>([])
  const [status, setStatus] = useState('正在加载项目…')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [reload, setReload] = useState(0)
  const [missingCount, setMissingCount] = useState(0)
  const missingReferences = useRef<string[]>([])
  const setMissingReferences = useCallback((ids: string[]) => {
    missingReferences.current = ids
    setMissingCount(ids.length)
  }, [])
  const active = useRef<GenerationProject | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const revisions = useRef(new Map<string, number>())
  const epoch = useRef(0)
  const saveError = useRef('')
  const inputPrompt = useStore((state) => state.prompt)
  const inputParams = useStore((state) => state.params)
  const [writerId] = useState(() => {
    const id = sessionStorage.getItem(PROJECT_WRITER_KEY) ?? createProjectId()
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
    const generation = ++epoch.current
    let canceled = false
    const isStale = () => canceled || generation !== epoch.current
    active.current = null
    saveError.current = ''
    setError('')
    setProject(null)
    void (async () => {
      const all = await getAllGenerationProjects()
      if (isStale()) return
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
        const { available, missing } = await readProjectReferences(next.referenceImageIds)
        if (isStale()) return
        setMissingReferences(missing)
        useStore.getState().setInputImages(available)
        useStore.getState().setPrompt(next.inputDraft?.prompt ?? '')
        useStore.getState().setParams(next.inputDraft?.params ?? DEFAULT_PARAMS)
      } else setMissingReferences([])
      if (isStale()) return
      rememberActiveProject(next.id)
      active.current = next
      setProject(next)
      setStatus(selected ? '已自动保存' : '新项目')
      setBusy(false)
    })().catch((cause) => {
      if (!isStale()) setError(`项目加载失败：${String(cause)}`)
    })
    return () => {
      canceled = true
    }
  }, [reload, setMissingReferences, writerId])

  useEffect(() => {
    let mounted = true
    let importVersion = 0
    const pauseForReset = () => {
      epoch.current++
      importVersion++
      active.current = null
      setMissingReferences([])
      setProject(null)
      setError('')
      setSwitching(false)
    }
    const refresh = () => {
      pauseForReset()
      setReload((value) => value + 1)
    }
    const refreshList = () => {
      const version = ++importVersion
      const projectId = active.current?.id
      const missing = missingReferences.current
      if (projectId && missing.length) {
        void readProjectReferences(missing)
          .then(({ available, missing: unresolved }) => {
            const current = active.current
            if (
              !mounted ||
              version !== importVersion ||
              current?.id !== projectId ||
              missingReferences.current !== missing
            )
              return
            if (!available.length) return
            const state = useStore.getState()
            const restored = new Map<string, InputImage>(available.map((image) => [image.id, image]))
            for (const image of state.inputImages) restored.set(image.id, image)
            const ids = withMissingReferences(
              current.referenceImageIds,
              state.inputImages.map(({ id }) => id),
              missing,
            )
            setMissingReferences(unresolved)
            state.setInputImages(
              ids.flatMap((id) => {
                const image = restored.get(id)
                return image ? [image] : []
              }),
            )
          })
          .catch(() => useStore.getState().showToast('参考图暂未恢复，重新打开项目后可重试。', 'error'))
      }
      void getAllGenerationProjects()
        .then((items) => {
          if (mounted && version === importVersion) {
            setProjects((current) => {
              const latest = new Map(items.map((item) => [item.id, item]))
              for (const item of current) {
                if ((latest.get(item.id)?.revision ?? -1) <= item.revision) latest.set(item.id, item)
              }
              return [...latest.values()]
            })
          }
        })
        .catch((cause) => {
          if (mounted && version === importVersion)
            useStore.getState().showToast(`项目列表刷新失败：${String(cause)}`, 'error')
        })
    }
    window.addEventListener(PROJECT_DATA_RESET_EVENT, pauseForReset)
    window.addEventListener(PROJECT_DATA_EVENT, refresh)
    window.addEventListener(PROJECT_DATA_IMPORTED_EVENT, refreshList)
    return () => {
      mounted = false
      window.removeEventListener(PROJECT_DATA_RESET_EVENT, pauseForReset)
      window.removeEventListener(PROJECT_DATA_EVENT, refresh)
      window.removeEventListener(PROJECT_DATA_IMPORTED_EVENT, refreshList)
    }
  }, [setMissingReferences])

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
    (workspace: PlannerWorkspaceDraft, visibleReferenceIds: string[]) => {
      const current = active.current
      if (!current) return
      const referenceImageIds = withMissingReferences(
        current.referenceImageIds,
        visibleReferenceIds,
        missingReferences.current,
      )
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
    const generation = epoch.current
    const isStale = () => generation !== epoch.current
    setSwitching(true)
    try {
      await queue.current
      if (isStale()) return
      if (saveError.current) throw new Error(saveError.current)
      const all = await getAllGenerationProjects()
      if (isStale()) return
      const next = id ? all.find((item) => item.id === id) : createGenerationProject()
      if (!next) throw new Error('项目不存在，请重新加载项目列表。')
      const { available, missing } = await readProjectReferences(next.referenceImageIds)
      if (isStale()) return
      savePlannerWorkspaceDraft(next.workspace)
      next.workspace = readPlannerWorkspaceDraft()
      const state = useStore.getState()
      setMissingReferences(missing)
      state.setInputImages(available)
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
      if (!isStale()) useStore.getState().showToast(String(cause), 'error')
    } finally {
      if (!isStale()) setSwitching(false)
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
      <div className="ui-panel animate-fade-up flex flex-col items-center justify-center gap-3 px-6 py-20 text-center" role="status">
        {!error && <div className="progress-ring" aria-hidden="true" />}
        <p className={error ? 'text-sm font-medium text-[var(--danger)]' : 'text-sm text-[var(--text-2)]'}>
          {error || '正在加载项目…'}
        </p>
        {error && (
          <button type="button" className="ui-btn ui-btn-primary mt-1" onClick={() => setReload((n) => n + 1)}>
            重试加载
          </button>
        )}
      </div>
    )

  const statusTone = error
    ? 'bg-red-500'
    : busy || status.includes('正在')
      ? 'bg-amber-500 animate-pulse'
      : 'bg-emerald-500'

  return (
    <div className="animate-fade-up">
      <section className="project-toolbar" aria-label="商品项目" data-no-drag-select>
        <div
          aria-hidden="true"
          className="hidden h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--surface-inset)] text-[var(--text-2)] shadow-[inset_0_0_0_1px_var(--line)] sm:grid"
        >
          <FolderIcon className="h-4 w-4" />
        </div>
        <label>
          <span className="shrink-0">项目</span>
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
          <span className="shrink-0">名称</span>
          <input
            aria-label="项目名称"
            value={project.name}
            maxLength={100}
            disabled={switching || Boolean(error)}
            placeholder="输入商品或项目名称…"
            onChange={(event) => save({ ...active.current!, name: event.target.value, updatedAt: Date.now() })}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="project-new-btn"
            disabled={busy || switching || Boolean(error)}
            onClick={() => void switchProject()}
          >
            <PlusIcon className="h-3.5 w-3.5" />
            新建项目
          </button>
          <span
            role="status"
            className="inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-[var(--surface-inset)] px-2.5 text-xs font-medium text-[var(--text-2)] shadow-[inset_0_0_0_1px_var(--line)]"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${statusTone}`} aria-hidden="true" />
            {busy ? '当前操作完成后可切换项目' : status}
          </span>
        </div>
        {error && (
          <div role="alert" className="ui-callout ui-callout-danger w-full flex-wrap items-center justify-between gap-2 text-sm">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => {
                // Keep the unsaved work as a new project when storage is available again.
                const copy = {
                  ...active.current!,
                  id: createProjectId(),
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
      {missingCount > 0 && (
        <p role="status" className="ui-callout ui-callout-warning mb-4 text-sm">
          {missingCount} 张项目参考图暂未找到，引用已保留；导入包含原图的备份后会自动恢复。
        </p>
      )}
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
    </div>
  )
}
