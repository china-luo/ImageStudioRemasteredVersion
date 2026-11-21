import { useCallback } from 'react'
import type { TaskRecord } from '../../types'
import { downloadImageIdsAsZip, formatExportFileTime } from '../../lib/downloadImages'
import { getSelectedOutputImageIds } from '../../lib/taskSelection'

type ToastType = 'info' | 'success' | 'error'

type SelectionDownloadOptions = {
  tasks: TaskRecord[]
  selectedTaskIds: string[]
  showToast: (message: string, type?: ToastType) => void
  clearSelection: () => void
}

export function useSelectionDownload({ tasks, selectedTaskIds, showToast, clearSelection }: SelectionDownloadOptions) {
  return useCallback(async () => {
    const imageIds = getSelectedOutputImageIds(tasks, selectedTaskIds)
    if (imageIds.length === 0) {
      showToast('选中的记录没有图片', 'info')
      return
    }

    try {
      const timeStr = formatExportFileTime(new Date())
      showToast(`正在打包 ${imageIds.length} 张图片…`, 'info')
      let lastProgress = 0
      const { successCount, failCount, canceled } = await downloadImageIdsAsZip(
        imageIds,
        `batch-${timeStr}`,
        (completed, total) => {
          const progress = Math.round((completed / total) * 100)
          if (progress >= lastProgress + 25 || completed === total) {
            lastProgress = progress
            showToast(`正在打包：${progress}%`, 'info')
          }
        },
      )
      if (canceled) return

      if (successCount === 0) {
        showToast('下载失败', 'error')
      } else if (failCount > 0) {
        showToast(`已生成 ZIP：成功 ${successCount} 张，失败 ${failCount} 张`, 'error')
      } else {
        showToast(`ZIP 下载成功：${successCount} 张图片`, 'success')
      }
    } catch (error) {
      console.error(error)
      showToast('下载失败', 'error')
    }
    clearSelection()
  }, [clearSelection, selectedTaskIds, showToast, tasks])
}
