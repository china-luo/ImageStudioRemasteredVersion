import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadImageIds } from './downloadImages'

describe('desktop image downloads', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('saves multiple images through one desktop batch operation', async () => {
    const selectImageSaveDirectory = vi.fn(async () => true)
    const saveImageFile = vi.fn(async (file: { fileName: string; data: Uint8Array }) => file.fileName)
    const finishImageSave = vi.fn(async () => undefined)
    vi.stubGlobal('window', {
      imageStudioDesktop: { isDesktop: true, platform: 'win32', selectImageSaveDirectory, saveImageFile, finishImageSave },
      setTimeout,
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(['image'], { type: 'image/jpeg' }),
    })))

    const result = await downloadImageIds(['data:image/jpeg;base64,YQ==', 'data:image/jpeg;base64,Yg=='], 'batch-test')

    expect(selectImageSaveDirectory).toHaveBeenCalledOnce()
    expect(saveImageFile.mock.calls.map(([file]) => file.fileName)).toEqual([
      'batch-test-01.jpg',
      'batch-test-02.jpg',
    ])
    expect(finishImageSave).toHaveBeenCalledOnce()
    expect(result).toEqual({ canceled: false, successCount: 2, failCount: 0 })
  })

  it('reports a canceled folder selection without failed downloads', async () => {
    const selectImageSaveDirectory = vi.fn(async () => false)
    const saveImageFile = vi.fn()
    const finishImageSave = vi.fn()
    vi.stubGlobal('window', {
      imageStudioDesktop: { isDesktop: true, platform: 'win32', selectImageSaveDirectory, saveImageFile, finishImageSave },
      setTimeout,
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(['image'], { type: 'image/png' }),
    })))

    await expect(downloadImageIds(['data:image/png;base64,YQ==', 'data:image/png;base64,Yg=='], 'batch-test')).resolves.toEqual({
      canceled: true,
      successCount: 0,
      failCount: 0,
    })
    expect(saveImageFile).not.toHaveBeenCalled()
    expect(finishImageSave).not.toHaveBeenCalled()
  })

  it('keeps browser batch downloads on the existing link-based path', async () => {
    const downloadedNames: string[] = []
    const anchor = {
      href: '',
      download: '',
      click: vi.fn(() => downloadedNames.push(anchor.download)),
    }
    vi.stubGlobal('window', {
      setTimeout: (callback: () => void) => {
        callback()
        return 1
      },
    })
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    })
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:test'),
      revokeObjectURL: vi.fn(),
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(['image'], { type: 'image/webp' }),
    })))

    await expect(downloadImageIds(['data:image/webp;base64,YQ==', 'data:image/webp;base64,Yg=='], 'browser')).resolves.toEqual({
      canceled: false,
      successCount: 2,
      failCount: 0,
    })
    expect(downloadedNames).toEqual(['browser-01.webp', 'browser-02.webp'])
  })
})
