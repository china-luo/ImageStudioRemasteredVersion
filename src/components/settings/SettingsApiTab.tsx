import type { Dispatch, DragEvent, MutableRefObject, RefObject, SetStateAction, TouchEvent } from 'react'
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_FAL_BASE_URL,
  DEFAULT_FAL_MODEL,
  DEFAULT_IMAGES_MODEL,
  DEFAULT_SETTINGS,
  DEFAULT_VOLCENGINE_BASE_URL,
  getApiProviderLabel,
  isOpenRouterImageGenerationProfile,
} from '../../lib/apiProfiles'
import type { ApiProfile, AppSettings, CustomProviderDefinition } from '../../types'
import Select from '../Select'
import ViewportTooltip from '../ViewportTooltip'
import { ChevronDownIcon, CopyIcon, DragHandleIcon, LinkIcon, PlusIcon, TrashIcon } from '../icons'

type SelectOption = {
  label: string
  value: string | number
  variant?: 'action' | 'danger'
  draggable?: boolean
  actions?: Array<{ label: string; variant?: 'danger'; onClick: () => void }>
}

export type SettingsApiTabProps = {
  draft: AppSettings
  activeProfile: ApiProfile
  activeCustomProvider?: CustomProviderDefinition
  apiConfigView: 'generation' | 'analysis'
  setApiConfigView: Dispatch<SetStateAction<'generation' | 'analysis'>>
  showApiKey: boolean
  setShowApiKey: Dispatch<SetStateAction<boolean>>
  showProfileMenu: boolean
  setShowProfileMenu: Dispatch<SetStateAction<boolean>>
  profileMenuMaxHeight: number
  profileMenuRef: RefObject<HTMLDivElement | null>
  profileMenuTriggerRef: RefObject<HTMLButtonElement | null>
  profileImportUrlTooltipVisible: boolean
  setProfileImportUrlTooltipVisible: Dispatch<SetStateAction<boolean>>
  duplicateProfileTooltipVisible: boolean
  setDuplicateProfileTooltipVisible: Dispatch<SetStateAction<boolean>>
  profileImportUrlTooltipTimerRef: MutableRefObject<number | null>
  duplicateProfileTooltipTimerRef: MutableRefObject<number | null>
  draggedProfileId: string | null
  dragOverProfileId: string | null
  dragDropPosition: 'before' | 'after' | null
  providerOptions: SelectOption[]
  amazonPlannerProfiles: ApiProfile[]
  amazonPlannerProfile?: ApiProfile
  amazonPlannerProfileOptions: SelectOption[]
  amazonPlannerModelOptions: SelectOption[]
  sopReverseProfileOptions: SelectOption[]
  vocProfileOptions: SelectOption[]
  activeProviderUsesApiUrl: boolean
  activeProviderIsOpenAICompatible: boolean
  activeProviderSupportsApiProxy: boolean
  apiProxyAvailable: boolean
  apiProxyLocked: boolean
  apiProxyChecked: boolean
  apiProxyEnabled: boolean
  apiProxyUrlLocked: boolean
  apiProxyUsesDynamicTarget: boolean
  timeoutInput: string
  setTimeoutInput: Dispatch<SetStateAction<string>>
  updateProfileMenuMaxHeight: () => void
  clearProfileImportUrlTooltipTimer: () => void
  clearDuplicateProfileTooltipTimer: () => void
  confirmCopyProfileImportUrl: (profile: ApiProfile) => void
  duplicateActiveProfile: () => void
  createNewProfile: () => void
  switchProfile: (id: string) => void
  deleteProfile: (id: string) => void
  handleProfileDragStart: (event: DragEvent, id: string) => void
  handleProfileDragOver: (event: DragEvent, id: string) => void
  handleProfileDrop: (event: DragEvent, id: string) => void
  handleProfileDragEnd: () => void
  handleProfileTouchStart: (event: TouchEvent, profile: ApiProfile) => void
  handleProfileTouchMove: (event: TouchEvent) => void
  handleProfileTouchEnd: (event: TouchEvent) => void
  setConfirmDialog: (dialog: { title: string; message: string; action: () => void }) => void
  commitSettings: (settings: AppSettings) => void
  updateAmazonPlannerModel: (model: string) => void
  updateActiveProfile: (patch: Partial<ApiProfile>, commit?: boolean) => void
  commitActiveProfilePatch: (patch: Partial<ApiProfile>) => void
  handleProviderTypeChange: (value: string | number) => void
  handleProviderReorder: (
    sourceValue: string | number,
    targetValue: string | number,
    position: 'before' | 'after' | null,
  ) => void
  getDefaultModelForMode: (mode: AppSettings['apiMode']) => string
  isDefaultModelForModeSwitch: (model: string) => boolean
  commitTimeout: () => void
  saveApiSettings: () => void
}

export default function SettingsApiTab(props: SettingsApiTabProps) {
  const {
    draft,
    activeProfile,
    activeCustomProvider,
    apiConfigView,
    setApiConfigView,
    showApiKey,
    setShowApiKey,
    showProfileMenu,
    setShowProfileMenu,
    profileMenuMaxHeight,
    profileMenuRef,
    profileMenuTriggerRef,
    profileImportUrlTooltipVisible,
    setProfileImportUrlTooltipVisible,
    duplicateProfileTooltipVisible,
    setDuplicateProfileTooltipVisible,
    profileImportUrlTooltipTimerRef,
    duplicateProfileTooltipTimerRef,
    draggedProfileId,
    dragOverProfileId,
    dragDropPosition,
    providerOptions,
    amazonPlannerProfiles,
    amazonPlannerProfile,
    amazonPlannerProfileOptions,
    amazonPlannerModelOptions,
    sopReverseProfileOptions,
    vocProfileOptions,
    activeProviderUsesApiUrl,
    activeProviderIsOpenAICompatible,
    activeProviderSupportsApiProxy,
    apiProxyAvailable,
    apiProxyLocked,
    apiProxyChecked,
    apiProxyEnabled,
    apiProxyUrlLocked,
    apiProxyUsesDynamicTarget,
    timeoutInput,
    setTimeoutInput,
    updateProfileMenuMaxHeight,
    clearProfileImportUrlTooltipTimer,
    clearDuplicateProfileTooltipTimer,
    confirmCopyProfileImportUrl,
    duplicateActiveProfile,
    createNewProfile,
    switchProfile,
    deleteProfile,
    handleProfileDragStart,
    handleProfileDragOver,
    handleProfileDrop,
    handleProfileDragEnd,
    handleProfileTouchStart,
    handleProfileTouchMove,
    handleProfileTouchEnd,
    setConfirmDialog,
    commitSettings,
    updateAmazonPlannerModel,
    updateActiveProfile,
    commitActiveProfilePatch,
    handleProviderTypeChange,
    handleProviderReorder,
    getDefaultModelForMode,
    isDefaultModelForModeSwitch,
    commitTimeout,
    saveApiSettings,
  } = props

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="space-y-4 rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.025]">
        <div className="border-b border-gray-100 pb-4 dark:border-white/[0.07]">
          <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">API 配置</h4>
          <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
            按用途切换并维护图片生成或 AI 分析连接。
          </p>
          <div
            className="mt-4 grid grid-cols-2 rounded-xl bg-gray-100 p-1 dark:bg-white/[0.06]"
            role="tablist"
            aria-label="API 配置类型"
          >
            <button
              type="button"
              role="tab"
              aria-selected={apiConfigView === 'generation'}
              onClick={() => setApiConfigView('generation')}
              className={`h-9 rounded-lg px-3 text-sm font-medium transition ${apiConfigView === 'generation' ? 'bg-white text-gray-900 shadow-sm dark:bg-white/[0.12] dark:text-white' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
            >
              图片生成
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={apiConfigView === 'analysis'}
              onClick={() => setApiConfigView('analysis')}
              className={`h-9 rounded-lg px-3 text-sm font-medium transition ${apiConfigView === 'analysis' ? 'bg-white text-gray-900 shadow-sm dark:bg-white/[0.12] dark:text-white' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}
            >
              AI 分析
            </button>
          </div>
        </div>
        <div className={apiConfigView === 'generation' ? 'block' : 'hidden'}>
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="block text-sm text-gray-600 dark:text-gray-300">当前配置</span>
            <span className="relative inline-flex">
              <button
                type="button"
                onClick={() => confirmCopyProfileImportUrl(activeProfile)}
                onMouseEnter={() => setProfileImportUrlTooltipVisible(true)}
                onMouseLeave={() => setProfileImportUrlTooltipVisible(false)}
                onFocus={() => setProfileImportUrlTooltipVisible(true)}
                onBlur={() => setProfileImportUrlTooltipVisible(false)}
                onTouchStart={() => {
                  clearProfileImportUrlTooltipTimer()
                  profileImportUrlTooltipTimerRef.current = window.setTimeout(() => {
                    setProfileImportUrlTooltipVisible(true)
                    profileImportUrlTooltipTimerRef.current = null
                  }, 450)
                }}
                onTouchEnd={clearProfileImportUrlTooltipTimer}
                onTouchCancel={clearProfileImportUrlTooltipTimer}
                className="flex h-5 w-5 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.08] dark:hover:text-gray-200"
                aria-label={`复制导入配置「${activeProfile.name}」的 URL`}
              >
                <LinkIcon className="h-3.5 w-3.5" />
              </button>
              <ViewportTooltip visible={profileImportUrlTooltipVisible} className="whitespace-nowrap">
                复制导入 URL
              </ViewportTooltip>
            </span>
            <span className="relative inline-flex">
              <button
                type="button"
                onClick={duplicateActiveProfile}
                onMouseEnter={() => setDuplicateProfileTooltipVisible(true)}
                onMouseLeave={() => setDuplicateProfileTooltipVisible(false)}
                onFocus={() => setDuplicateProfileTooltipVisible(true)}
                onBlur={() => setDuplicateProfileTooltipVisible(false)}
                onTouchStart={() => {
                  clearDuplicateProfileTooltipTimer()
                  duplicateProfileTooltipTimerRef.current = window.setTimeout(() => {
                    setDuplicateProfileTooltipVisible(true)
                    duplicateProfileTooltipTimerRef.current = null
                  }, 450)
                }}
                onTouchEnd={clearDuplicateProfileTooltipTimer}
                onTouchCancel={clearDuplicateProfileTooltipTimer}
                className="flex h-5 w-5 items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.08] dark:hover:text-gray-200"
                aria-label={`复制一份配置「${activeProfile.name}」`}
              >
                <CopyIcon className="h-3.5 w-3.5" />
              </button>
              <ViewportTooltip visible={duplicateProfileTooltipVisible} className="whitespace-nowrap">
                复制当前配置
              </ViewportTooltip>
            </span>
          </div>
          <div ref={profileMenuRef} className="relative">
            <button
              ref={profileMenuTriggerRef}
              type="button"
              onClick={() => {
                if (!showProfileMenu) updateProfileMenuMaxHeight()
                setShowProfileMenu(!showProfileMenu)
              }}
              className="flex w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2 text-sm text-gray-700 outline-none transition hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:hover:bg-white/[0.06]"
              title={activeProfile.name}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate">{activeProfile.name}</span>
                <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
                  {getApiProviderLabel(draft, activeProfile.provider)}
                </span>
              </span>
              <ChevronDownIcon
                className={`w-3.5 h-3.5 flex-shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${showProfileMenu ? 'rotate-180' : ''}`}
              />
            </button>

            {showProfileMenu && (
              <>
                <div
                  className="absolute right-0 top-full z-50 mt-1.5 w-full overflow-hidden overflow-y-auto rounded-xl border border-gray-200/60 bg-white/95 py-1 shadow-[0_8px_30px_rgb(0,0,0,0.12)] ring-1 ring-black/5 backdrop-blur-xl animate-dropdown-down dark:border-white/[0.08] dark:bg-gray-900/95 dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] dark:ring-white/10 custom-scrollbar"
                  style={{ maxHeight: profileMenuMaxHeight }}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      createNewProfile()
                    }}
                    className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10"
                  >
                    <span className="truncate font-semibold">创建新配置</span>
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                      <PlusIcon className="h-4 w-4" />
                    </span>
                  </button>
                  <div>
                    {draft.profiles.map((profile) => (
                      <div
                        key={profile.id}
                        data-profile-id={profile.id}
                        title={profile.name}
                        draggable
                        onDragStart={(e) => handleProfileDragStart(e, profile.id)}
                        onDragOver={(e) => handleProfileDragOver(e, profile.id)}
                        onDrop={(e) => handleProfileDrop(e, profile.id)}
                        onDragEnd={handleProfileDragEnd}
                        onTouchStart={(e) => handleProfileTouchStart(e, profile)}
                        onTouchMove={handleProfileTouchMove}
                        onTouchEnd={handleProfileTouchEnd}
                        onTouchCancel={handleProfileDragEnd}
                        onClick={(e) => {
                          // Don't switch profile if they are clicking the drag handle
                          if ((e.target as HTMLElement).closest('[data-drag-handle]')) return
                          e.preventDefault()
                          switchProfile(profile.id)
                        }}
                        className={`relative group flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left text-xs transition-colors ${draggedProfileId === profile.id ? 'opacity-40 bg-gray-100 dark:bg-white/[0.04]' : profile.id === activeProfile.id ? 'bg-blue-50 font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-400' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.06]'}`}
                      >
                        {dragOverProfileId === profile.id &&
                          dragDropPosition === 'before' &&
                          draggedProfileId !== profile.id && (
                            <div className="absolute -top-[1px] left-0 right-0 h-[2px] bg-blue-500 rounded-full z-40 shadow-sm pointer-events-none" />
                          )}
                        {dragOverProfileId === profile.id &&
                          dragDropPosition === 'after' &&
                          draggedProfileId !== profile.id && (
                            <div className="absolute -bottom-[1px] left-0 right-0 h-[2px] bg-blue-500 rounded-full z-40 shadow-sm pointer-events-none" />
                          )}
                        <div className="flex min-w-0 flex-1 items-center gap-2 pr-2">
                          <div
                            data-drag-handle
                            className="flex cursor-grab active:cursor-grabbing items-center justify-center text-gray-400 opacity-60 transition-opacity hover:opacity-100 dark:text-gray-500"
                            style={{ touchAction: 'none' }}
                            title="拖拽排序"
                          >
                            <DragHandleIcon className="h-3.5 w-3.5" />
                          </div>
                          <span className="min-w-0 truncate">{profile.name}</span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] shrink-0 ${profile.id === activeProfile.id ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' : 'bg-gray-100 text-gray-500 dark:bg-white/[0.08] dark:text-gray-400'}`}
                          >
                            {getApiProviderLabel(draft, profile.provider)}
                          </span>
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              confirmCopyProfileImportUrl(profile)
                            }}
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 opacity-60 transition-all hover:bg-gray-100 hover:text-gray-600 hover:opacity-100 dark:hover:bg-white/[0.08] dark:hover:text-gray-200"
                            aria-label={`复制导入配置「${profile.name}」的 URL`}
                            title="复制导入 URL"
                          >
                            <LinkIcon className="h-3.5 w-3.5" />
                          </button>
                          {draft.profiles.length > 1 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                setConfirmDialog({
                                  title: '删除配置',
                                  message: `确定要删除配置「${profile.name}」吗？`,
                                  action: () => deleteProfile(profile.id),
                                })
                              }}
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-400 opacity-60 transition-all hover:bg-red-50 hover:text-red-500 hover:opacity-100 dark:hover:bg-red-500/10"
                              aria-label="删除配置"
                            >
                              <TrashIcon className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div
          className={`${apiConfigView === 'analysis' ? 'block' : 'hidden'} rounded-2xl border border-blue-100 bg-blue-50/70 p-3 dark:border-blue-400/20 dark:bg-blue-400/10`}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-blue-900 dark:text-blue-100">AI 策划配置</span>
            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-500/20 dark:text-blue-200">
              Chat
            </span>
          </div>
          <Select
            value={draft.amazonPlannerProfileId}
            onChange={(value) => commitSettings({ ...draft, amazonPlannerProfileId: String(value) })}
            disabled={amazonPlannerProfiles.length === 0}
            options={amazonPlannerProfileOptions}
            className="w-full rounded-xl border border-blue-200/70 bg-white/80 px-3 py-2.5 text-sm text-blue-900 outline-none transition focus:border-blue-300 dark:border-blue-400/20 dark:bg-gray-950/40 dark:text-blue-100 dark:focus:border-blue-500/50"
          />
          <div className="mt-3">
            <div className="mb-1.5 text-xs font-medium text-blue-800 dark:text-blue-200">策划模型</div>
            <Select
              value={amazonPlannerProfile?.model ?? ''}
              onChange={(value) => updateAmazonPlannerModel(String(value))}
              disabled={!amazonPlannerProfile}
              options={amazonPlannerModelOptions}
              className="w-full rounded-xl border border-blue-200/70 bg-white/80 px-3 py-2.5 text-sm text-blue-900 outline-none transition focus:border-blue-300 dark:border-blue-400/20 dark:bg-gray-950/40 dark:text-blue-100 dark:focus:border-blue-500/50"
            />
          </div>
          <div data-selectable-text className="mt-2 text-xs leading-relaxed text-blue-800 dark:text-blue-200">
            只用于首页 Amazon 面板的 AI 策划；普通生图只接受当前配置为 Images API。生图默认使用 gpt-image-2；AI
            策划可选择 gpt-5.5 或 gpt-5.6-sol。
          </div>
        </div>

        <div
          className={`${apiConfigView === 'analysis' ? 'block' : 'hidden'} rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3 dark:border-emerald-400/20 dark:bg-emerald-400/10`}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">拆图反推 AI 配置</span>
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200">
              Analysis
            </span>
          </div>
          <Select
            value={draft.sopReverseProfileId}
            onChange={(value) => commitSettings({ ...draft, sopReverseProfileId: String(value) })}
            disabled={amazonPlannerProfiles.length === 0}
            options={sopReverseProfileOptions}
            className="w-full rounded-xl border border-emerald-200/70 bg-white/80 px-3 py-2.5 text-sm text-emerald-900 outline-none transition focus:border-emerald-300 dark:border-emerald-400/20 dark:bg-gray-950/40 dark:text-emerald-100 dark:focus:border-emerald-500/50"
          />
          <div data-selectable-text className="mt-2 text-xs leading-relaxed text-emerald-800 dark:text-emerald-200">
            只用于「电商图片拆解反推 SOP」板块，把竞品图、表单信息和 SOP
            一起发送给文本/多模态模型分析；不会改变图片生成板块的当前配置。
          </div>
        </div>

        <div
          className={`${apiConfigView === 'analysis' ? 'block' : 'hidden'} rounded-2xl border border-amber-100 bg-amber-50/70 p-3 dark:border-amber-400/20 dark:bg-amber-400/10`}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-amber-900 dark:text-amber-100">VOC 评论分析配置</span>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/20 dark:text-amber-200">
              Reviews
            </span>
          </div>
          <Select
            value={draft.vocProfileId}
            onChange={(value) => commitSettings({ ...draft, vocProfileId: String(value) })}
            disabled={amazonPlannerProfiles.length === 0}
            options={vocProfileOptions}
            className="w-full rounded-xl border border-amber-200/70 bg-white/80 px-3 py-2.5 text-sm text-amber-900 outline-none transition focus:border-amber-300 dark:border-amber-400/20 dark:bg-gray-950/40 dark:text-amber-100 dark:focus:border-amber-500/50"
          />
          <input
            value={draft.vocApiKey}
            onChange={(event) => commitSettings({ ...draft, vocApiKey: event.target.value })}
            type="password"
            placeholder="Shulex OpenAPI Key（实时任务）"
            className="mt-2 w-full rounded-xl border border-amber-200/70 bg-white/80 px-3 py-2.5 text-sm text-amber-900 outline-none transition placeholder:text-amber-700/45 focus:border-amber-300 dark:border-amber-400/20 dark:bg-gray-950/40 dark:text-amber-100 dark:placeholder:text-amber-200/35 dark:focus:border-amber-500/50"
          />
          <div data-selectable-text className="mt-2 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
            只用于「VOC 评论分析」板块。评论拉取使用 Shulex OpenAPI Key；AI 分析使用这里选择的 Chat/Responses 模型。
          </div>
        </div>

        <div className={apiConfigView === 'generation' ? 'contents' : 'hidden'}>
          {/* 1. 配置名称 */}
          <label className="block">
            <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">配置名称</span>
            <input
              value={activeProfile.name}
              onChange={(e) => updateActiveProfile({ name: e.target.value })}
              onBlur={(e) => commitActiveProfilePatch({ name: e.target.value })}
              type="text"
              className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
            />
          </label>

          {/* 2. 服务商类型 */}
          <div className="block">
            <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">服务商类型</span>
            <Select
              value={activeProfile.provider}
              onChange={handleProviderTypeChange}
              onReorder={handleProviderReorder}
              options={providerOptions}
              className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
            />
          </div>

          {/* 3. API URL */}
          {activeProviderUsesApiUrl && (
            <label className="block">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="block text-sm text-gray-600 dark:text-gray-300">API URL</span>
              </div>
              <input
                value={activeProfile.baseUrl}
                onChange={(e) => updateActiveProfile({ baseUrl: e.target.value })}
                onBlur={(e) => commitActiveProfilePatch({ baseUrl: e.target.value })}
                type="text"
                disabled={apiProxyUrlLocked}
                placeholder={
                  activeProfile.provider === 'fal'
                    ? DEFAULT_FAL_BASE_URL
                    : activeProfile.provider === 'volcengine'
                      ? DEFAULT_VOLCENGINE_BASE_URL
                      : DEFAULT_SETTINGS.baseUrl
                }
                className={`w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50 ${apiProxyUrlLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
              />
              <div
                data-selectable-text
                className="mt-1.5 min-h-[22px] flex items-center text-xs text-gray-500 dark:text-gray-500"
              >
                {apiProxyEnabled ? (
                  apiProxyUsesDynamicTarget ? (
                    <span className="text-blue-600 dark:text-blue-400">
                      已开启代理，请求会通过本地服务转发到此 API URL。
                    </span>
                  ) : (
                    <span className="text-yellow-600 dark:text-yellow-500">
                      已开启代理，实际请求目标由部署端决定，此处设置被忽略。
                    </span>
                  )
                ) : activeProfile.provider === 'fal' ? (
                  <span>
                    默认使用{' '}
                    <code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">{DEFAULT_FAL_BASE_URL}</code>
                    ；填写自定义地址时将作为 fal.ai 代理 URL。
                  </span>
                ) : (
                  <span>
                    支持通过查询参数覆盖：
                    <code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">?apiUrl=</code>
                  </span>
                )}
              </div>
            </label>
          )}

          {/* 4. API 代理（紧跟 URL） */}
          {apiProxyAvailable && activeProviderSupportsApiProxy && (
            <div className="block">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="block text-sm text-gray-600 dark:text-gray-300">API 代理</span>
                <button
                  type="button"
                  onClick={() => {
                    if (!apiProxyLocked) updateActiveProfile({ apiProxy: !activeProfile.apiProxy }, true)
                  }}
                  disabled={apiProxyLocked}
                  className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${apiProxyChecked ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'} ${apiProxyLocked ? 'cursor-not-allowed opacity-70' : ''}`}
                  role="switch"
                  aria-checked={apiProxyChecked}
                  aria-label="API 代理"
                >
                  <span
                    className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${apiProxyChecked ? 'translate-x-[14px]' : 'translate-x-[2px]'}`}
                  />
                </button>
              </div>
              <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
                {apiProxyUsesDynamicTarget
                  ? apiProxyLocked
                    ? '当前部署已锁定 API 代理为开启；API URL 仍可修改，代理会按该地址转发。'
                    : '开启后通过同源代理访问上方 API URL，用于解决浏览器跨域限制。'
                  : apiProxyLocked
                    ? '当前部署已锁定 API 代理为开启，API URL 设置会被忽略。'
                    : '当前部署提供同源代理时默认开启，可手动关闭。开启后用于解决浏览器跨域限制，API URL 设置会被忽略。'}
              </div>
            </div>
          )}

          {/* 5. API Key */}
          <div className="block">
            <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">API Key</span>
            <div className="relative">
              <input
                value={activeProfile.apiKey}
                onChange={(e) => updateActiveProfile({ apiKey: e.target.value })}
                onBlur={(e) => commitActiveProfilePatch({ apiKey: e.target.value })}
                type={showApiKey ? 'text' : 'password'}
                placeholder={activeProfile.provider === 'fal' ? 'FAL_KEY' : 'sk-...'}
                className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 pr-10 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
                tabIndex={-1}
              >
                {showApiKey ? (
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    viewBox="0 0 24 24"
                  >
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                ) : (
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    viewBox="0 0 24 24"
                  >
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                )}
              </button>
            </div>
            <div data-selectable-text className="mt-1.5 text-xs text-gray-500 dark:text-gray-500">
              支持通过查询参数覆盖：
              <code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">?apiKey=</code>
            </div>
          </div>

          {/* 6. API 接口（Images/Responses/Chat） */}
          {false && activeProfile.provider === 'openai' && (
            <div className="block">
              <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">API 接口</span>
              <Select
                value={activeProfile.apiMode ?? DEFAULT_SETTINGS.apiMode}
                onChange={(value) => {
                  const apiMode = value as AppSettings['apiMode']
                  const nextModel = isDefaultModelForModeSwitch(activeProfile.model)
                    ? getDefaultModelForMode(apiMode)
                    : activeProfile.model
                  updateActiveProfile({ apiMode, model: nextModel }, true)
                }}
                options={[
                  { label: 'Images API (/v1/images)', value: 'images' },
                  { label: 'Responses API (/v1/responses)', value: 'responses' },
                  { label: 'Chat Completions (/chat/completions)', value: 'chat' },
                ]}
                className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
              />
              <div data-selectable-text className="mt-1.5 text-xs text-gray-500 dark:text-gray-500">
                支持通过查询参数覆盖：
                <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">apiMode=images</code>、
                <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">apiMode=responses</code> 或{' '}
                <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">apiMode=chat</code>。
              </div>
            </div>
          )}

          {/* 7. 模型 ID（紧跟接口选择） */}
          <label className="block">
            <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">模型 ID</span>
            <input
              value={activeProfile.model}
              onChange={(e) => updateActiveProfile({ model: e.target.value })}
              onBlur={(e) => commitActiveProfilePatch({ model: e.target.value })}
              type="text"
              placeholder={
                activeProfile.provider === 'fal'
                  ? DEFAULT_FAL_MODEL
                  : getDefaultModelForMode(activeProfile.apiMode ?? DEFAULT_SETTINGS.apiMode)
              }
              className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
            />
            <div data-selectable-text className="mt-1.5 text-xs text-gray-500 dark:text-gray-500">
              {activeProfile.provider === 'fal' ? (
                <>
                  当前适配{' '}
                  <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">{DEFAULT_FAL_MODEL}</code>。
                </>
              ) : activeCustomProvider ? (
                <>
                  当前使用{' '}
                  <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">
                    {activeCustomProvider.name}
                  </code>
                  。
                </>
              ) : (activeProfile.apiMode ?? DEFAULT_SETTINGS.apiMode) === 'responses' ? (
                <>Responses API 用于 AI 策划等文本/多模态流程；普通生图请切换到 Images API 配置。</>
              ) : (activeProfile.apiMode ?? DEFAULT_SETTINGS.apiMode) === 'chat' ? (
                isOpenRouterImageGenerationProfile(activeProfile) ? (
                  <>OpenRouter 图片模型通过 Chat Completions 生图；模型需支持 image 输出。</>
                ) : (
                  <>
                    Chat Completions 用于 AI 策划文本模型，默认{' '}
                    <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">{DEFAULT_CHAT_MODEL}</code>
                    ；普通生图请使用 Images API 配置。
                  </>
                )
              ) : (
                <>
                  Images API 需要使用 GPT Image 模型，例如{' '}
                  <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">{DEFAULT_IMAGES_MODEL}</code>。
                </>
              )}
              {activeProfile.provider === 'openai' && (
                <>
                  支持通过查询参数覆盖：
                  <code className="rounded bg-gray-100 px-1 py-0.5 dark:bg-white/[0.06]">?model=</code>。
                </>
              )}
            </div>
          </label>

          {/* 9. 返回 Base64 图片数据 */}
          {activeProviderIsOpenAICompatible && (
            <div className="block">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="block text-sm text-gray-600 dark:text-gray-300">返回 Base64 图片数据</span>
                <button
                  type="button"
                  onClick={() =>
                    updateActiveProfile({ responseFormatB64Json: !activeProfile.responseFormatB64Json }, true)
                  }
                  className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${activeProfile.responseFormatB64Json ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                  role="switch"
                  aria-checked={!!activeProfile.responseFormatB64Json}
                  aria-label="返回 Base64 图片数据"
                >
                  <span
                    className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${activeProfile.responseFormatB64Json ? 'translate-x-[14px]' : 'translate-x-[2px]'}`}
                  />
                </button>
              </div>
              <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
                开启后在请求体中追加{' '}
                <code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">response_format: b64_json</code>
                ，使接口直接返回 Base64 编码的图片数据而非 URL。并非所有服务商和网关都支持此功能。
              </div>
            </div>
          )}

          {/* 10. Codex CLI 兼容模式 */}
          {activeProfile.provider === 'openai' && (
            <div className="block">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="block text-sm text-gray-600 dark:text-gray-300">Codex CLI 兼容模式</span>
                <button
                  type="button"
                  onClick={() => updateActiveProfile({ codexCli: !activeProfile.codexCli }, true)}
                  className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${activeProfile.codexCli ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                  role="switch"
                  aria-checked={activeProfile.codexCli}
                  aria-label="Codex CLI 兼容模式"
                >
                  <span
                    className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${activeProfile.codexCli ? 'translate-x-[14px]' : 'translate-x-[2px]'}`}
                  />
                </button>
              </div>
              <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
                开启后应用 Codex CLI 实际支持的参数。支持查询参数覆盖：
                <code className="bg-gray-100 dark:bg-white/[0.06] px-1 py-0.5 rounded">codexCli=true</code>。
              </div>
            </div>
          )}

          {/* 11. 请求超时 */}
          {activeProviderIsOpenAICompatible && (
            <label className="block">
              <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">请求超时 (秒)</span>
              <input
                value={timeoutInput}
                onChange={(e) => setTimeoutInput(e.target.value)}
                onBlur={commitTimeout}
                type="number"
                min={10}
                max={600}
                className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
              />
            </label>
          )}

          <div className="-mx-5 -mb-5 border-t border-gray-200/70 bg-gray-50/80 px-5 py-4 dark:border-white/[0.08] dark:bg-white/[0.02]">
            <button
              type="button"
              onClick={saveApiSettings}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 active:scale-[0.99] dark:bg-blue-500 dark:hover:bg-blue-400"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
                <path d="M17 21v-8H7v8" />
                <path d="M7 3v5h8" />
              </svg>
              保存 API 配置
            </button>
          </div>
        </div>
      </section>
      <section className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-sm dark:border-white/[0.08] dark:bg-white/[0.025]">
        <div className="border-b border-gray-100 p-5 dark:border-white/[0.07]">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">图片编辑</h4>
            <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-medium text-gray-500 dark:bg-white/[0.07] dark:text-gray-400">
              可选
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
            仅供独立图片编辑器使用，不改变首页图片生成配置。
          </p>
        </div>
        <div className="space-y-4 p-5">
          <label className="block">
            <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">编辑器 API 配置</span>
            <Select
              value={draft.seedreamEditorProfileId || ''}
              onChange={(value) => commitSettings({ ...draft, seedreamEditorProfileId: String(value) })}
              options={[
                { label: '跟随当前图片生成配置', value: '' },
                ...draft.profiles
                  .filter((profile) => profile.apiMode === 'images')
                  .map((profile) => ({
                    label: `${profile.name} · ${profile.model || '未配置模型'}`,
                    value: profile.id,
                  })),
              ]}
              className="w-full rounded-xl border border-gray-200/70 bg-gray-50 px-3 py-2.5 text-sm text-gray-700 outline-none dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200"
            />
          </label>
          <div className="rounded-xl border border-dashed border-gray-300 px-4 py-5 text-center text-xs leading-5 text-gray-500 dark:border-white/[0.14] dark:text-gray-400">
            需要 Seedream 5.0 Pro 时，可先在左侧图片生成卡片中新建对应配置，再在这里选用。
          </div>
        </div>
      </section>
    </div>
  )
}
