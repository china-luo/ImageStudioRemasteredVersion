import { useCallback } from 'react'
import type { TaskRecord } from '../../types'
import { downloadImageIds, formatExportFileTime } from '../../lib/downloadImages'
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
      const { successCount, failCount, canceled } = await downloadImageIds(imageIds, `batch-${timeStr}`)
      if (canceled) return

      if (successCount === 0) {
        showToast('下载失败', 'error')
      } else if (failCount > 0) {
        showToast(`部分下载失败：成功 ${successCount}，失败 ${failCount}`, 'error')
      } else {
        showToast(successCount > 1 ? `下载成功：${successCount} 张图片` : '下载成功', 'success')
      }
    } catch (error) {
      console.error(error)
      showToast('下载失败', 'error')
    }
    clearSelection()
  }, [clearSelection, selectedTaskIds, showToast, tasks])
}
