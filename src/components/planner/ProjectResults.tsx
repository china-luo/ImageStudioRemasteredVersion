import { useEffect, useMemo, useState } from 'react'
import {
  ensureImageThumbnailCached,
  subscribeImageThumbnail,
  resumeTaskRecovery,
  retryTask,
  useStore,
} from '../../store'
import { canResumeTaskRecovery, isTaskReconnecting } from '../../lib/taskRecovery'
import { projectTasks } from '../../lib/generationProjects'
import { downloadProjectFinals } from '../../lib/projectExport'
import { getWorkflowLabel } from '../../lib/taskHistory'
import { getAPlusContentTypeLabel } from '../../lib/listingPlanner'
import type { GenerationProject } from '../../types'
import { CheckIcon, DownloadIcon, EyeIcon, RefreshIcon } from '../icons'

export type ProjectFinalChange = (slotId: string, taskId: string | null, imageId?: string) => void

function ResultImage({ imageId, label }: { imageId: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let canceled = false
    const unsubscribe = subscribeImageThumbnail(imageId, (thumbnail) => {
      if (!canceled) setSrc(thumbnail.dataUrl)
    })
    void ensureImageThumbnailCached(imageId)
      .then((value) => {
        if (!canceled && value) setSrc(value.dataUrl)
      })
      .catch(() => {
        if (!canceled) setSrc(null)
      })
    return () => {
      canceled = true
      unsubscribe()
    }
  }, [imageId])
  return src ? (
    <img src={src} alt={label} loading="lazy" />
  ) : (
    <span className="px-3 text-center text-xs text-[var(--text-3)]">图片正在读取或已丢失</span>
  )
}

export default function ProjectResults({
  project,
  slotId,
  onFinalChange,
}: {
  project: GenerationProject
  slotId?: string
  onFinalChange: ProjectFinalChange
}) {
  const tasks = useStore((s) => s.tasks)
  const showToast = useStore((s) => s.showToast)
  const [exporting, setExporting] = useState(false)
  const [retrying, setRetrying] = useState<string | null>(null)
  const currentTasks = useMemo(() => projectTasks(tasks, project.id, slotId), [tasks, project.id, slotId])
  const groups = useMemo(() => {
    const result = new Map<string, typeof tasks>()
    for (const task of currentTasks) {
      const key = task.category?.projectSlotId
      if (key) result.set(key, [...(result.get(key) ?? []), task])
    }
    return [...result.entries()]
  }, [currentTasks])
  const missingFinals = Object.entries(project.finals).filter(
    ([key, final]) =>
      (!slotId || key === slotId) &&
      !currentTasks.some(
        (task) => task.id === final.taskId && task.status === 'done' && task.outputImages.includes(final.imageId),
      ),
  )

  const renderStatusBadge = (task: (typeof tasks)[number]) => {
    if (task.recoveryPausedReason) return <span className="ui-badge ui-badge-warning">查询已暂停</span>
    if (isTaskReconnecting(task))
      return (
        <span className="ui-badge ui-badge-accent">
          <span className="ui-dot animate-pulse" />
          正在查询
        </span>
      )
    if (task.status === 'running')
      return (
        <span className="ui-badge ui-badge-accent">
          <span className="ui-dot animate-pulse" />
          生成中
        </span>
      )
    if (task.status === 'error') return <span className="ui-badge ui-badge-danger">生成失败</span>
    return <span className="ui-badge ui-badge-success">已完成</span>
  }

  const renderTaskCard = (key: string, task: (typeof tasks)[number], index: number, showContext: boolean) => (
    <article key={task.id} data-project-task-id={task.id} className="project-version">
      {showContext && (
        <div className="project-version-context">
          {task.category?.amazonSlot} · {getWorkflowLabel(task.category?.workflow ?? 'unknown')}
          {task.category?.aPlusType ? ` · ${getAPlusContentTypeLabel(task.category.aPlusType)}` : ''}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 text-xs">
        <strong className="font-bold text-[var(--text-1)]">版本 {index + 1}</strong>
        {renderStatusBadge(task)}
      </div>
      <time className="mt-1 block text-[11px] text-[var(--text-3)]">{new Date(task.createdAt).toLocaleString()}</time>
      {task.error && <p className="ui-callout ui-callout-danger my-2.5 break-words py-2 text-xs">{task.error}</p>}
      {canResumeTaskRecovery(task) ? (
        <button type="button" className="mt-2.5 w-full" onClick={() => resumeTaskRecovery(task.id)}>
          <RefreshIcon className="h-3.5 w-3.5" />
          继续查询
        </button>
      ) : task.status === 'error' && !isTaskReconnecting(task) ? (
        <button
          type="button"
          className="mt-2.5 w-full"
          disabled={Boolean(retrying)}
          onClick={async () => {
            setRetrying(task.id)
            try {
              await retryTask(task)
            } catch (error) {
              showToast(String(error), 'error')
            } finally {
              setRetrying(null)
            }
          }}
        >
          <RefreshIcon className="h-3.5 w-3.5" />
          {retrying === task.id ? '正在提交…' : '重试生成'}
        </button>
      ) : null}
      {task.outputImages.map((imageId, imageIndex) => {
        const selected = project.finals[key]?.taskId === task.id && project.finals[key]?.imageId === imageId
        return (
          <div key={`${imageId}-${imageIndex}`} className="mt-3">
            <button
              className="project-image group relative"
              type="button"
              aria-label={`查看版本 ${index + 1} 图片 ${imageIndex + 1}`}
              onClick={() => useStore.getState().setLightboxImageId(imageId, task.outputImages)}
            >
              <ResultImage imageId={imageId} label={`版本 ${index + 1} 图片 ${imageIndex + 1}`} />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10.5px] font-semibold text-white opacity-0 backdrop-blur-sm transition group-hover:opacity-100"
              >
                <EyeIcon className="h-3 w-3" />
                大图
              </span>
            </button>
            <button
              type="button"
              className="w-full"
              aria-pressed={selected}
              disabled={task.status !== 'done'}
              onClick={() => onFinalChange(key, selected ? null : task.id, imageId)}
            >
              {selected && <CheckIcon className="h-3.5 w-3.5" />}
              {selected ? '已定稿 · 取消' : '选为定稿'}
            </button>
          </div>
        )
      })}
      <button
        type="button"
        className="mt-2.5 w-full text-xs text-[var(--text-2)]"
        onClick={() => useStore.getState().setDetailTaskId(task.id)}
      >
        查看任务详情
      </button>
    </article>
  )
  const runExport = async () => {
    setExporting(true)
    try {
      const count = await downloadProjectFinals(project, tasks)
      showToast(`已导出 ${count} 张项目定稿`, 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setExporting(false)
    }
  }
  const runningCount = currentTasks.filter((task) => task.status === 'running').length
  const doneCount = currentTasks.filter((task) => task.status === 'done').length
  const errorCount = currentTasks.filter((task) => task.status === 'error').length
  const finalsCount = Object.keys(project.finals).length

  return (
    <section
      aria-label={slotId ? '当前图片位版本' : '当前项目结果'}
      className={`project-results ${slotId ? 'project-results--slot' : 'project-results--project'}`}
      data-no-drag-select
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-bold text-[var(--text-1)]">{slotId ? '图片版本' : '当前项目结果'}</h3>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-3)]">
            <span>{runningCount} 个生成中</span>
            <span>·</span>
            <span>{doneCount} 次完成</span>
            <span>·</span>
            <span>{errorCount} 次失败</span>
          </p>
        </div>
        {!slotId && (
          <button
            type="button"
            disabled={exporting || !finalsCount}
            onClick={() => void runExport()}
            className={
              finalsCount > 0
                ? '!border-transparent !bg-[var(--cta-bg)] !text-[var(--cta-fg)] shadow-[var(--shadow-glow)] hover:!bg-[var(--cta-bg-hover)]'
                : ''
            }
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            {exporting ? '正在打包…' : `导出定稿（${finalsCount}）`}
          </button>
        )}
      </div>

      {!currentTasks.length && (
        <div className="ui-inset mt-4 px-5 py-8 text-center text-sm text-[var(--text-2)]">
          {slotId
            ? '这个图片位尚未生成图片。生成后可在这里比较版本并选择定稿。'
            : '当前项目尚无生成结果。先在“图片制作”中选择图片位并生成。旧记录可在“全部历史”中查看。'}
        </div>
      )}
      {missingFinals.map(([key]) => (
        <div
          key={key}
          role="alert"
          className="ui-callout ui-callout-danger my-3 items-center justify-between gap-2 text-sm"
        >
          <span>定稿记录已删除，请取消此定稿后重新选择。</span>
          <button type="button" onClick={() => onFinalChange(key, null)}>
            取消失效定稿
          </button>
        </div>
      ))}
      {slotId ? (
        groups.map(([key, versions]) => (
          <section
            key={key}
            className="project-slot-results"
            aria-label={`图片位 ${versions[0].category?.amazonSlot ?? ''} 的版本`}
          >
            <div className="project-version-grid">
              {versions.map((task, index) => renderTaskCard(key, task, index, false))}
            </div>
          </section>
        ))
      ) : (
        <div className="project-version-grid project-version-grid--overview mt-4" aria-label="全部成品图片">
          {groups.flatMap(([key, versions]) => versions.map((task, index) => renderTaskCard(key, task, index, true)))}
        </div>
      )}
    </section>
  )
}
