import { describe, expect, it } from 'vitest'
import type { TaskRecord } from '../types'
import { getFilteredTasks, getSelectedOutputImageIds, getSelectionToggleTaskIds } from './taskSelection'

const task = (id: string, createdAt: number, outputImages: string[] = []): TaskRecord => ({
  id,
  prompt: id,
  params: {
    size: '1024x1024',
    quality: 'auto',
    output_format: 'jpeg',
    output_compression: 70,
    moderation: 'auto',
    n: 1,
  },
  inputImageIds: [],
  outputImages,
  status: 'done',
  error: null,
  createdAt,
  finishedAt: createdAt,
  elapsed: 0,
})

describe('task selection helpers', () => {
  it('sorts filtered history and toggles all visible tasks', () => {
    const tasks = [task('old', 1), task('new', 2)]
    const filtered = getFilteredTasks(tasks, {
      searchQuery: '',
      filterStatus: 'all',
      filterFavorite: false,
      filterProductTitle: '',
      filterWorkflow: 'all',
      filterAspect: 'all',
    })
    expect(filtered.map((item) => item.id)).toEqual(['new', 'old'])
    expect(getSelectionToggleTaskIds([], filtered)).toEqual(['new', 'old'])
    expect(getSelectionToggleTaskIds(['new', 'old'], filtered)).toBeNull()
  })

  it('collects only selected output images', () => {
    expect(getSelectedOutputImageIds([task('a', 1, ['1', '2']), task('b', 2, ['3'])], ['b', 'a'])).toEqual([
      '1',
      '2',
      '3',
    ])
  })
})
