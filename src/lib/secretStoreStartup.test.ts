import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSecrets } from './secretStore'

function memoryStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => {
      entries.delete(key)
    },
    setItem: (key, value) => {
      entries.set(key, value)
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

let storage: Storage
let session: Storage
let read: ReturnType<typeof deferred<AppSecrets>>
let getSecrets: ReturnType<typeof vi.fn>
let setSecrets: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetModules()
  storage = memoryStorage()
  session = memoryStorage()
  read = deferred<AppSecrets>()
  getSecrets = vi.fn(() => read.promise)
  setSecrets = vi.fn(async (_secrets: AppSecrets) => true)
  vi.stubGlobal('localStorage', storage)
  vi.stubGlobal('sessionStorage', session)
  vi.stubGlobal('window', {
    localStorage: storage,
    sessionStorage: session,
    imageStudioDesktop: { isDesktop: true, getSecrets, setSecrets },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function setupStore() {
  const store = await import('../store')
  const profileId = store.useStore.getState().settings.activeProfileId
  const saved: AppSecrets = {
    apiKey: 'saved-image-secret',
    vocApiKey: 'saved-voc-secret',
    profiles: { [profileId]: 'saved-image-secret', 'other-profile': 'saved-other-secret' },
  }
  return { ...store, profileId, saved }
}

describe('credential startup and settings writes', () => {
  it('does not write an empty vault on startup or after unrelated settings edits', async () => {
    const { useStore, initSettingsSecrets, saved, profileId } = await setupStore()
    useStore.getState().setSettings({ ...useStore.getState().settings, enterSubmit: true })
    expect(setSecrets).not.toHaveBeenCalled()
    read.resolve(saved)
    await initSettingsSecrets()

    expect(getSecrets).toHaveBeenCalledTimes(1)
    expect(useStore.getState().settings.apiKey).toBe(saved.apiKey)
    expect(useStore.getState().settings.vocApiKey).toBe(saved.vocApiKey)
    expect(useStore.getState().settings.profiles.find((profile) => profile.id === profileId)?.apiKey).toBe(saved.apiKey)
    expect(useStore.getState().settings.enterSubmit).toBe(true)
    expect(setSecrets).not.toHaveBeenCalled()

    useStore.getState().setSettings({ enterSubmit: false })
    expect(setSecrets).not.toHaveBeenCalled()
    expect(storage.getItem('amazon-image-studio')).not.toContain(saved.apiKey)
  })

  it('replays early key edits without erasing credentials not loaded yet', async () => {
    const { useStore, initSettingsSecrets, saved, profileId } = await setupStore()
    useStore.getState().setSettings({ apiKey: 'early-edited-secret' })
    expect(setSecrets).not.toHaveBeenCalled()
    read.resolve(saved)
    await initSettingsSecrets()

    expect(useStore.getState().settings.apiKey).toBe('early-edited-secret')
    expect(useStore.getState().settings.vocApiKey).toBe(saved.vocApiKey)
    expect(setSecrets).toHaveBeenLastCalledWith({
      ...saved,
      apiKey: 'early-edited-secret',
      profiles: { ...saved.profiles, [profileId]: 'early-edited-secret' },
    })
  })

  it('honors explicit early clears while preserving other saved keys', async () => {
    const { useStore, initSettingsSecrets, saved, profileId } = await setupStore()
    useStore.getState().setSettings({ apiKey: '', vocApiKey: '' })
    expect(setSecrets).not.toHaveBeenCalled()
    read.resolve(saved)
    await initSettingsSecrets()

    expect(useStore.getState().settings.apiKey).toBe('')
    expect(useStore.getState().settings.vocApiKey).toBe('')
    expect(setSecrets).toHaveBeenLastCalledWith({
      apiKey: '',
      vocApiKey: '',
      profiles: { ...saved.profiles, [profileId]: '' },
    })
  })

  it('waits for pending hydration before the actual clearData configuration reset', async () => {
    const { clearData, useStore, initSettingsSecrets, saved } = await setupStore()
    vi.stubGlobal('document', { documentElement: { style: { setProperty: vi.fn() } } })
    Object.defineProperty(window, 'location', { configurable: true, value: { href: 'http://localhost/' } })
    let completed = false
    const reset = clearData({ clearConfig: true, clearTasks: false }).then(() => {
      completed = true
    })
    await Promise.resolve()
    expect(completed).toBe(false)
    expect(setSecrets).not.toHaveBeenCalled()

    read.resolve(saved)
    await reset
    await initSettingsSecrets()
    await Promise.resolve()
    expect(useStore.getState().settings.apiKey).toBe('')
    expect(useStore.getState().settings.vocApiKey).toBe('')
    expect(useStore.getState().settings.profiles.every((profile) => !profile.apiKey)).toBe(true)
    expect(setSecrets).toHaveBeenLastCalledWith({ apiKey: '', vocApiKey: '', profiles: {} })
    expect(session.getItem('amazon-image-studio-secrets')).not.toContain(saved.apiKey)
    expect(session.getItem('amazon-image-studio-secrets')).not.toContain(saved.vocApiKey)
  })

  it('applies URL settings after hydration with URL key precedence and retained existing keys', async () => {
    const { useStore, initSettingsSecrets, saved, profileId } = await setupStore()
    const { buildSettingsFromUrlParams } = await import('./urlSettings')
    const startup = initSettingsSecrets().then(() => {
      useStore
        .getState()
        .setSettings(
          buildSettingsFromUrlParams(
            useStore.getState().settings,
            new URLSearchParams('apiUrl=https%3A%2F%2Furl.example%2Fv1&apiKey=url-secret'),
          ),
        )
    })
    read.resolve(saved)
    await startup
    await Promise.resolve()

    const settings = useStore.getState().settings
    expect(settings.apiKey).toBe('url-secret')
    expect(settings.activeProfileId).not.toBe(profileId)
    expect(settings.profiles.find((profile) => profile.id === profileId)?.apiKey).toBe(saved.apiKey)
    expect(settings.vocApiKey).toBe(saved.vocApiKey)
    expect(setSecrets).toHaveBeenLastCalledWith(
      expect.objectContaining({
        apiKey: 'url-secret',
        vocApiKey: saved.vocApiKey,
        profiles: expect.objectContaining({ [profileId]: saved.apiKey, [settings.activeProfileId]: 'url-secret' }),
      }),
    )
    expect(storage.getItem('amazon-image-studio')).not.toContain('url-secret')
    expect(storage.getItem('amazon-image-studio')).not.toContain(saved.apiKey)
  })

  it('supports intentional key removal after hydration', async () => {
    const { useStore, initSettingsSecrets, saved, profileId } = await setupStore()
    read.resolve(saved)
    await initSettingsSecrets()
    useStore.getState().setSettings({ apiKey: '', vocApiKey: '' })
    await Promise.resolve()
    expect(useStore.getState().settings.apiKey).toBe('')
    expect(useStore.getState().settings.vocApiKey).toBe('')
    const written = setSecrets.mock.calls.at(-1)?.[0] as AppSecrets
    expect(written.apiKey).toBe('')
    expect(written.vocApiKey).toBe('')
    expect(written.profiles[profileId]).toBeUndefined()
  })

  it.each(['false', 'reject'])('同一完整设置在写入 %s 后重试最新凭据，成功后停止重复写入', async (failure) => {
    const { useStore, initSettingsSecrets, saved, profileId } = await setupStore()
    read.resolve(saved)
    await initSettingsSecrets()
    const showToast = vi.spyOn(useStore.getState(), 'showToast')
    if (failure === 'false') setSecrets.mockResolvedValueOnce(false)
    else setSecrets.mockRejectedValueOnce(new Error('temporary vault failure'))
    const snapshot = {
      ...useStore.getState().settings,
      apiKey: 'retry-same-secret',
      profiles: useStore
        .getState()
        .settings.profiles.map((profile) =>
          profile.id === profileId ? { ...profile, apiKey: 'retry-same-secret' } : profile,
        ),
    }
    useStore.getState().setSettings(snapshot)
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledTimes(1))
    expect(setSecrets).toHaveBeenCalledTimes(1)

    useStore.getState().setSettings(snapshot)
    await vi.waitFor(() => expect(setSecrets).toHaveBeenCalledTimes(2))
    expect(setSecrets.mock.calls[1][0]).toEqual(setSecrets.mock.calls[0][0])
    expect(setSecrets).toHaveBeenLastCalledWith({
      ...saved,
      apiKey: 'retry-same-secret',
      profiles: { ...saved.profiles, [profileId]: 'retry-same-secret' },
    })
    expect(getSecrets).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledTimes(1)

    useStore.getState().setSettings(snapshot)
    await Promise.resolve()
    expect(setSecrets).toHaveBeenCalledTimes(2)
  })

  it('旧写入成功不会清除较新快照的待保存状态，同值重试仍按顺序写入最新值', async () => {
    const { useStore, initSettingsSecrets, saved } = await setupStore()
    read.resolve(saved)
    await initSettingsSecrets()
    const firstWrite = deferred<boolean>()
    const secondWrite = deferred<boolean>()
    setSecrets.mockImplementationOnce(() => firstWrite.promise).mockImplementationOnce(() => secondWrite.promise)
    useStore.getState().setSettings({ apiKey: 'older-secret' })
    useStore.getState().setSettings({ apiKey: 'latest-secret' })
    await vi.waitFor(() => expect(setSecrets).toHaveBeenCalledTimes(1))

    firstWrite.resolve(true)
    await vi.waitFor(() => expect(setSecrets).toHaveBeenCalledTimes(2))
    const snapshot = useStore.getState().settings
    useStore.getState().setSettings(snapshot)
    await Promise.resolve()
    expect(setSecrets).toHaveBeenCalledTimes(2)

    secondWrite.resolve(false)
    await vi.waitFor(() => expect(setSecrets).toHaveBeenCalledTimes(3))
    expect(setSecrets.mock.calls.map(([secrets]) => secrets.apiKey)).toEqual([
      'older-secret',
      'latest-secret',
      'latest-secret',
    ])
    expect(setSecrets.mock.calls[2][0].profiles['other-profile']).toBe(saved.profiles['other-profile'])
    useStore.getState().setSettings(snapshot)
    await Promise.resolve()
    expect(setSecrets).toHaveBeenCalledTimes(3)
  })

  it('旧快照失败后新快照成功，不会使后续同值保存重复写入', async () => {
    const { useStore, initSettingsSecrets, saved } = await setupStore()
    read.resolve(saved)
    await initSettingsSecrets()
    const firstWrite = deferred<boolean>()
    setSecrets.mockImplementationOnce(() => firstWrite.promise)
    const showToast = vi.spyOn(useStore.getState(), 'showToast')
    useStore.getState().setSettings({ apiKey: 'older-secret' })
    useStore.getState().setSettings({ apiKey: 'latest-success-secret' })
    await vi.waitFor(() => expect(setSecrets).toHaveBeenCalledTimes(1))
    firstWrite.resolve(false)
    await vi.waitFor(() => expect(setSecrets).toHaveBeenCalledTimes(2))
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(setSecrets).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: 'latest-success-secret' }))

    useStore.getState().setSettings({ ...useStore.getState().settings })
    await Promise.resolve()
    expect(setSecrets).toHaveBeenCalledTimes(2)
  })

  it('同值完整设置可重试失败的读取，读取成功前不会写入保险库', async () => {
    const { useStore, initSettingsSecrets, saved, profileId } = await setupStore()
    const snapshot = {
      ...useStore.getState().settings,
      apiKey: 'pending-full-snapshot-secret',
      profiles: useStore
        .getState()
        .settings.profiles.map((profile) =>
          profile.id === profileId ? { ...profile, apiKey: 'pending-full-snapshot-secret' } : profile,
        ),
    }
    useStore.getState().setSettings(snapshot)
    read.reject(new Error('temporary read failure'))
    await initSettingsSecrets()
    expect(setSecrets).not.toHaveBeenCalled()

    const retry = deferred<AppSecrets>()
    getSecrets.mockImplementation(() => retry.promise)
    useStore.getState().setSettings(snapshot)
    expect(getSecrets).toHaveBeenCalledTimes(2)
    expect(setSecrets).not.toHaveBeenCalled()
    retry.resolve(saved)
    await initSettingsSecrets()
    expect(setSecrets).toHaveBeenCalledExactlyOnceWith({
      ...saved,
      apiKey: 'pending-full-snapshot-secret',
      profiles: { ...saved.profiles, [profileId]: 'pending-full-snapshot-secret' },
    })
    expect(useStore.getState().settings.vocApiKey).toBe(saved.vocApiKey)
  })

  it('读取前删除占位配置会移除对应的已保存密钥，同时保留其他未加载配置的密钥', async () => {
    const { useStore, initSettingsSecrets, saved } = await setupStore()
    const settings = useStore.getState().settings
    useStore.getState().setSettings({
      ...settings,
      profiles: [...settings.profiles, { ...settings.profiles[0], id: 'removed-profile', name: '待删除配置' }],
    })
    useStore.getState().setSettings({ profiles: settings.profiles })
    expect(setSecrets).not.toHaveBeenCalled()
    read.resolve({ ...saved, profiles: { ...saved.profiles, 'removed-profile': 'removed-secret' } })
    await initSettingsSecrets()

    expect(setSecrets).toHaveBeenCalledExactlyOnceWith(saved)
    const { getCachedSecrets } = await import('./secretStore')
    expect(getCachedSecrets().profiles['removed-profile']).toBeUndefined()
    expect(getCachedSecrets().profiles['other-profile']).toBe(saved.profiles['other-profile'])
  })

  it('serializes desktop writes so an older IPC write cannot finish after a newer edit', async () => {
    const { useStore, initSettingsSecrets, saved } = await setupStore()
    read.resolve(saved)
    await initSettingsSecrets()
    const firstWrite = deferred<void>()
    setSecrets.mockImplementationOnce(() => firstWrite.promise)
    useStore.getState().setSettings({ apiKey: 'first-secret' })
    useStore.getState().setSettings({ apiKey: 'second-secret' })
    await Promise.resolve()
    expect(setSecrets).toHaveBeenCalledTimes(1)
    firstWrite.resolve()
    await vi.waitFor(() => expect(setSecrets).toHaveBeenCalledTimes(2))
    expect(setSecrets.mock.calls[0][0].apiKey).toBe('first-secret')
    expect(setSecrets.mock.calls[1][0].apiKey).toBe('second-secret')
  })

  it('still saves to the desktop vault when session storage is unavailable', async () => {
    const { useStore, initSettingsSecrets, saved } = await setupStore()
    read.resolve(saved)
    await initSettingsSecrets()
    session.setItem = () => {
      throw new Error('storage blocked')
    }
    expect(() => useStore.getState().setSettings({ apiKey: 'desktop-only-secret' })).not.toThrow()
    await Promise.resolve()
    expect(setSecrets).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: 'desktop-only-secret' }))
  })

  it('does not reset the vault if the initial Electron read fails', async () => {
    getSecrets.mockRejectedValue(new Error('IPC unavailable'))
    const { useStore, initSettingsSecrets } = await setupStore()
    await initSettingsSecrets()
    useStore.getState().setSettings({ apiKey: 'replacement-secret' })
    await initSettingsSecrets()
    expect(setSecrets).not.toHaveBeenCalled()
    expect(useStore.getState().settings.apiKey).toBe('replacement-secret')
  })

  it('can retry a failed startup read and restore the vault without a credential edit', async () => {
    const { useStore, initSettingsSecrets, saved } = await setupStore()
    read.reject(new Error('temporary IPC failure'))
    await initSettingsSecrets()
    expect(setSecrets).not.toHaveBeenCalled()

    getSecrets.mockResolvedValue(saved)
    await initSettingsSecrets()
    expect(getSecrets).toHaveBeenCalledTimes(2)
    expect(useStore.getState().settings.apiKey).toBe(saved.apiKey)
    expect(useStore.getState().settings.vocApiKey).toBe(saved.vocApiKey)
    expect(setSecrets).not.toHaveBeenCalled()
  })

  it.each(['replacement-secret', ''])(
    'retries on a credential edit and replays %j over unread keys',
    async (apiKey) => {
      const { useStore, initSettingsSecrets, saved, profileId } = await setupStore()
      useStore.getState().setSettings({ apiKey: 'edited-before-failure', vocApiKey: '' })
      read.reject(new Error('temporary IPC failure'))
      await initSettingsSecrets()
      expect(setSecrets).not.toHaveBeenCalled()

      const retry = deferred<AppSecrets>()
      getSecrets.mockImplementation(() => retry.promise)
      useStore.getState().setSettings({ apiKey })
      const ready = initSettingsSecrets()
      expect(getSecrets).toHaveBeenCalledTimes(2)
      expect(setSecrets).not.toHaveBeenCalled()
      retry.resolve(saved)
      await ready

      expect(useStore.getState().settings.apiKey).toBe(apiKey)
      expect(useStore.getState().settings.vocApiKey).toBe('')
      expect(setSecrets).toHaveBeenLastCalledWith({
        apiKey,
        vocApiKey: '',
        profiles: { ...saved.profiles, [profileId]: apiKey },
      })
      useStore.getState().setSettings({ vocApiKey: 'new-voc-secret' })
      await vi.waitFor(() => expect(setSecrets).toHaveBeenCalledTimes(2))
      expect(setSecrets).toHaveBeenLastCalledWith(
        expect.objectContaining({ profiles: expect.objectContaining({ 'other-profile': 'saved-other-secret' }) }),
      )
    },
  )

  it('warns in Chinese on read failures without repeatedly showing the same warning', async () => {
    const { useStore, initSettingsSecrets } = await setupStore()
    const showToast = vi.spyOn(useStore.getState(), 'showToast')
    const now = vi.spyOn(Date, 'now').mockReturnValue(100_000)
    read.reject(new Error('private IPC details'))
    await initSettingsSecrets()
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('桌面凭据读取失败'), 'error')
    expect(showToast.mock.calls[0][0]).not.toContain('private IPC details')

    getSecrets.mockRejectedValue(new Error('still unavailable'))
    await initSettingsSecrets()
    useStore.getState().setSettings({ apiKey: 'unsaved-key' })
    await initSettingsSecrets()
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(setSecrets).not.toHaveBeenCalled()

    now.mockReturnValue(131_000)
    await initSettingsSecrets()
    expect(showToast).toHaveBeenCalledTimes(2)
  })

  it.each(['false', 'reject'])('warns when a desktop write returns %s and allows later saves', async (failure) => {
    const { useStore, initSettingsSecrets, saved } = await setupStore()
    read.resolve(saved)
    await initSettingsSecrets()
    const showToast = vi.spyOn(useStore.getState(), 'showToast')
    if (failure === 'false') setSecrets.mockResolvedValue(false)
    else setSecrets.mockRejectedValue(new Error('private vault error'))
    useStore.getState().setSettings({ apiKey: 'session-only-key' })
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledTimes(1))
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('桌面凭据保存失败'), 'error')
    expect(showToast.mock.calls[0][0]).not.toContain('private vault error')
    expect(useStore.getState().settings.apiKey).toBe('session-only-key')
    expect(session.getItem('amazon-image-studio-secrets')).toContain('session-only-key')

    useStore.getState().setSettings({ apiKey: 'second-session-key' })
    await vi.waitFor(() => expect(setSecrets).toHaveBeenCalledTimes(2))
    expect(showToast).toHaveBeenCalledTimes(1)
    setSecrets.mockResolvedValue(true)
    useStore.getState().setSettings({ apiKey: 'persisted-key' })
    await vi.waitFor(() => expect(setSecrets).toHaveBeenCalledTimes(3))
    expect(setSecrets).toHaveBeenLastCalledWith(
      expect.objectContaining({
        apiKey: 'persisted-key',
        vocApiKey: saved.vocApiKey,
        profiles: expect.objectContaining({ 'other-profile': 'saved-other-secret' }),
      }),
    )
  })
})

describe('Codex CLI dismissal privacy', () => {
  it('uses a profile identifier, never the key or URL, and preserves suppression', async () => {
    const { useStore, initSettingsSecrets, getCodexCliPromptKey, showCodexCliPrompt, saved } = await setupStore()
    read.resolve(saved)
    await initSettingsSecrets()
    useStore.getState().setSettings({ baseUrl: 'https://private-api.example/v1', apiKey: 'unique-codex-secret' })
    const id = getCodexCliPromptKey(useStore.getState().settings)
    expect(id).toMatch(/^codex-cli-profile-v2:/)
    expect(id).not.toContain('unique-codex-secret')
    expect(id).not.toContain('private-api.example')

    showCodexCliPrompt()
    useStore.getState().confirmDialog?.cancelAction?.()
    useStore.getState().setConfirmDialog(null)
    showCodexCliPrompt()
    expect(useStore.getState().confirmDialog).toBeNull()
    expect(useStore.getState().dismissedCodexCliPrompts).toEqual([id])
    const persisted = storage.getItem('amazon-image-studio')!
    expect(persisted).toContain(id)
    expect(persisted).not.toContain('unique-codex-secret')
    expect(persisted).not.toContain(saved.apiKey)
  })

  it('removes legacy plaintext entries from memory and existing localStorage', async () => {
    storage.setItem(
      'amazon-image-studio',
      JSON.stringify({
        state: { dismissedCodexCliPrompts: ['https://old.example/v1\nlegacy-leaked-secret'] },
        version: 0,
      }),
    )
    const { useStore, initSettingsSecrets, saved } = await setupStore()
    read.resolve(saved)
    await initSettingsSecrets()
    expect(useStore.getState().dismissedCodexCliPrompts).toEqual([])
    expect(storage.getItem('amazon-image-studio')).not.toContain('legacy-leaked-secret')
    useStore.getState().dismissCodexCliPrompt('https://old.example/v1\nlegacy-leaked-secret')
    expect(storage.getItem('amazon-image-studio')).not.toContain('legacy-leaked-secret')
  })

  it('retains only valid new-format dismissals through rehydration and serialization', async () => {
    const safeId = 'codex-cli-profile-v2:example-profile'
    storage.setItem(
      'amazon-image-studio',
      JSON.stringify({
        state: { dismissedCodexCliPrompts: [safeId, safeId, null, 'https://old.example/v1\nold-secret'] },
        version: 0,
      }),
    )
    const { useStore, initSettingsSecrets, getPersistedState, saved } = await setupStore()
    read.resolve(saved)
    await initSettingsSecrets()
    expect(useStore.getState().dismissedCodexCliPrompts).toEqual([safeId])
    const serialized = JSON.stringify(
      getPersistedState({
        ...useStore.getState(),
        dismissedCodexCliPrompts: [safeId, 'url\nshould-not-survive'],
      }),
    )
    expect(serialized).toContain(safeId)
    expect(serialized).not.toContain('should-not-survive')
    expect(serialized).not.toContain('old-secret')
  })
})
