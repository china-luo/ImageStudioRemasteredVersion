import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { appendSeedreamQuickAction, buildSeedreamEditPrompt, createImageEditorParams, createSeedreamEditorParams, findLatestImageEditorTask, findSeedreamAnnotationAtPoint, translateSeedreamAnnotation } from './seedreamEditor'

function editorTask(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: 'editor-task',
    prompt: 'edit image',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: ['source'],
    outputImages: ['output'],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    category: { workflow: 'seedream-edit' },
    imageEditContext: {
      engine: 'home',
      sourceImageId: 'source',
      referenceImageIds: [],
      userInstruction: 'edit image',
    },
    ...overrides,
  }
}

describe('Seedream editor prompt', () => {
  it('describes source and references without inventing a visual guide role', () => {
    const prompt = buildSeedreamEditPrompt({
      instruction: '把杯子替换成参考图里的玻璃杯',
      hasVisualGuide: false,
      referenceCount: 2,
    })

    expect(prompt).toContain('图1是必须编辑的原图')
    expect(prompt).toContain('图2是参考图1')
    expect(prompt).toContain('图3是参考图2')
    expect(prompt).not.toContain('视觉定位图')
    expect(prompt).toContain('只输出一张')
  })

  it('places the visual guide before references and forbids annotation lines', () => {
    const prompt = buildSeedreamEditPrompt({
      instruction: '删除箭头圈出的文字',
      hasVisualGuide: true,
      referenceCount: 1,
    })

    expect(prompt).toContain('图2是“视觉定位图”')
    expect(prompt).toContain('图3是参考图1')
    expect(prompt).toContain('不得出现任何红、蓝、绿、黄标注线')
    expect(prompt).toContain('删除箭头圈出的文字')
  })
})

describe('Seedream editor params', () => {
  it.each([
    ['2k', '2K'],
    ['4k', '4K'],
  ] as const)('locks %s tasks to one output', (resolution, expectedSize) => {
    expect(createSeedreamEditorParams(resolution)).toMatchObject({ size: expectedSize, n: 1 })
  })

  it('converts GPT editor tiers into dimensions that preserve the source ratio', () => {
    const profile = { provider: 'openai', model: 'gpt-image-2' }
    expect(createImageEditorParams('2k', profile, { width: 1200, height: 1200 })).toMatchObject({
      size: '2048x2048',
      n: 1,
    })
    expect(createImageEditorParams('4k', profile, { width: 1600, height: 900 })).toMatchObject({
      size: '3840x2160',
      n: 1,
    })
  })

  it('keeps Seedream Pro on its native resolution tiers', () => {
    expect(createImageEditorParams('4k', {
      provider: 'volcengine',
      model: 'doubao-seedream-5-0-pro-260628',
    }, { width: 1600, height: 900 })).toMatchObject({ size: '4K', n: 1 })
  })

  it('adds quick actions without overwriting the existing requirement', () => {
    expect(appendSeedreamQuickAction('保留产品', '改色')).toBe('保留产品；改色：')
    expect(appendSeedreamQuickAction('', '删除')).toBe('删除：')
  })
})

describe('Seedream editor history recovery', () => {
  it('keeps a preferred task when it belongs to the active engine', () => {
    const preferred = editorTask({ id: 'preferred', createdAt: 1 })
    const newer = editorTask({ id: 'newer', createdAt: 2 })

    expect(findLatestImageEditorTask([newer, preferred], 'home', preferred.id)?.id).toBe('preferred')
  })

  it('recovers the latest persisted task for each engine after switching', () => {
    const home = editorTask({ id: 'home', createdAt: 3 })
    const seedream = editorTask({
      id: 'seedream',
      createdAt: 4,
      apiProvider: 'volcengine',
      imageEditContext: {
        engine: 'seedream',
        sourceImageId: 'source',
        referenceImageIds: [],
        userInstruction: 'seedream edit',
      },
    })

    expect(findLatestImageEditorTask([home, seedream], 'home', seedream.id)?.id).toBe('home')
    expect(findLatestImageEditorTask([home, seedream], 'seedream', home.id)?.id).toBe('seedream')
  })

  it('recovers legacy categorized editor tasks without edit context', () => {
    const legacy = editorTask({
      id: 'legacy',
      apiProvider: 'volcengine',
      imageEditContext: undefined,
    })

    expect(findLatestImageEditorTask([legacy], 'seedream')?.id).toBe('legacy')
  })
})

describe('Seedream visual guide hit testing', () => {
  it.each([
    ['brush', [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }], { x: 0.3, y: 0.3 }],
    ['arrow', [{ x: 0.1, y: 0.5 }, { x: 0.8, y: 0.5 }], { x: 0.4, y: 0.5 }],
    ['rectangle', [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }], { x: 0.2, y: 0.5 }],
    ['ellipse', [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }], { x: 0.5, y: 0.2 }],
  ] as const)('finds a %s annotation for the eraser', (kind, points, point) => {
    expect(findSeedreamAnnotationAtPoint([
      { id: 'target', kind, color: '#ef4444', width: 0.006, points: [...points] },
    ], point, 1000, 1000)).toBe('target')
  })

  it('moves an existing annotation and keeps every point inside the image', () => {
    const annotation = {
      id: 'target',
      kind: 'arrow' as const,
      color: '#ef4444',
      width: 0.006,
      points: [{ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.7 }],
    }

    const moved = translateSeedreamAnnotation(annotation, { x: 0.1, y: -0.2 }).points
    expect(moved[0].x).toBeCloseTo(0.3)
    expect(moved[0].y).toBeCloseTo(0.1)
    expect(moved[1].x).toBeCloseTo(0.9)
    expect(moved[1].y).toBeCloseTo(0.5)
    const clamped = translateSeedreamAnnotation(annotation, { x: 0.5, y: 0.5 }).points
    expect(clamped[0].x).toBeCloseTo(0.4)
    expect(clamped[0].y).toBeCloseTo(0.6)
    expect(clamped[1]).toEqual({ x: 1, y: 1 })
  })
})

