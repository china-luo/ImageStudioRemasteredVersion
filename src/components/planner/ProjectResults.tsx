import { useEffect, useMemo, useState } from 'react'
import { ensureImageThumbnailCached, subscribeImageThumbnail, retryTask, useStore } from '../../store'
import { projectTasks } from '../../lib/generationProjects'
import { downloadProjectFinals } from '../../lib/projectExport'
import { getWorkflowLabel } from '../../lib/taskHistory'
import { getAPlusContentTypeLabel } from '../../lib/listingPlanner'
import type { GenerationProject } from '../../types'

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
    <span className="text-xs text-gray-500">图片正在读取或已丢失</span>
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
  return (
    <section aria-label={slotId ? '当前图片位版本' : '当前项目结果'} className="project-results" data-no-drag-select>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">{slotId ? '图片版本' : '当前项目结果'}</h3>
        {!slotId && (
          <button
            type="button"
            disabled={exporting || !Object.keys(project.finals).length}
            onClick={() => void runExport()}
          >
            {exporting ? '正在打包…' : `导出定稿（${Object.keys(project.finals).length}）`}
          </button>
        )}
      </div>
      <p className="my-2 text-xs text-gray-500">
        {currentTasks.filter((task) => task.status === 'running').length} 个生成中 ·{' '}
        {currentTasks.filter((task) => task.status === 'done').length} 次完成 ·{' '}
        {currentTasks.filter((task) => task.status === 'error').length} 次失败
      </p>
      {!currentTasks.length && (
        <p className="py-5 text-sm text-gray-500">
          {slotId
            ? '这个图片位尚未生成图片。生成后可在这里比较版本并选择定稿。'
            : '当前项目尚无生成结果。先在“图片制作”中选择图片位并生成。旧记录可在“全部历史”中查看。'}
        </p>
      )}
      {missingFinals.map(([key]) => (
        <div key={key} role="alert" className="my-2 text-sm text-red-600">
          定稿记录已删除，请取消此定稿后重新选择。<button onClick={() => onFinalChange(key, null)}>取消失效定稿</button>
        </div>
      ))}
      {groups.map(([key, versions]) => (
        <section
          key={key}
          className="project-slot-results"
          aria-label={`图片位 ${versions[0].category?.amazonSlot ?? ''} 的版本`}
        >
          {!slotId && (
            <h4 className="mb-3 text-sm font-medium">
              {versions[0].category?.amazonSlot} · {getWorkflowLabel(versions[0].category?.workflow ?? 'unknown')}
              {versions[0].category?.aPlusType ? ` · ${getAPlusContentTypeLabel(versions[0].category.aPlusType)}` : ''}
            </h4>
          )}
          <div className="project-version-grid">
            {versions.map((task, index) => (
              <article key={task.id} data-project-task-id={task.id} className="project-version">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <strong>版本 {index + 1}</strong>
                  <span>{task.status === 'running' ? '生成中' : task.status === 'error' ? '生成失败' : '已完成'}</span>
                </div>
                <time className="text-[11px] text-gray-500">{new Date(task.createdAt).toLocaleString()}</time>
                {task.error && <p className="my-2 break-words text-xs text-red-600">{task.error}</p>}
                {task.status === 'error' && (
                  <button
                    type="button"
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
                    {retrying === task.id ? '正在提交…' : '重试生成'}
                  </button>
                )}
                {task.outputImages.map((imageId, imageIndex) => {
                  const selected = project.finals[key]?.taskId === task.id && project.finals[key]?.imageId === imageId
                  return (
                    <div key={`${imageId}-${imageIndex}`} className="mt-3">
                      <button
                        className="project-image"
                        type="button"
                        aria-label={`查看版本 ${index + 1} 图片 ${imageIndex + 1}`}
                        onClick={() => useStore.getState().setLightboxImageId(imageId, task.outputImages)}
                      >
                        <ResultImage imageId={imageId} label={`版本 ${index + 1} 图片 ${imageIndex + 1}`} />
                      </button>
                      <button
                        type="button"
                        aria-pressed={selected}
                        disabled={task.status !== 'done'}
                        onClick={() => onFinalChange(key, selected ? null : task.id, imageId)}
                      >
                        {selected ? '已定稿 · 取消' : '选为定稿'}
                      </button>
                    </div>
                  )
                })}
                <button
                  type="button"
                  className="mt-2 text-xs"
                  onClick={() => useStore.getState().setDetailTaskId(task.id)}
                >
                  查看任务详情
                </button>
              </article>
            ))}
          </div>
        </section>
      ))}
    </section>
  )
}
