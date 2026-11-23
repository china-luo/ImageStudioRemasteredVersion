import { type DragEvent, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { getSopReverseProfile, validateApiProfile } from '../lib/apiProfiles'
import { callSopReverseApi } from '../lib/sopReverseApi'
import { copyTextToClipboard, getClipboardFailureMessage } from '../lib/clipboard'
import { storeImage } from '../lib/db'
import { extractEnglishImagePrompt, type SopForm } from '../lib/workspaceDrafts'
import {
  finishWorkspaceAnalysis,
  isWorkspaceAnalysisCurrent,
  startWorkspaceAnalysis,
  stopWorkspaceAnalysis,
} from '../lib/workspaceAnalysis'
import Select from './Select'
import MarkdownRenderer from './MarkdownRenderer'
import {
  CloseIcon,
  CopyIcon,
  EditIcon,
  EyeIcon,
  ImportIcon,
  RefreshIcon,
  ScanIcon,
  SettingsIcon,
  UploadCloudIcon,
} from './icons'

const FIELD_CLASS = 'ui-input'
const LABEL_CLASS = 'ui-label'
const MAX_REFERENCE_IMAGES = 8

const platformOptions = [
  { label: 'TikTok Shop', value: 'TikTok Shop' },
  { label: 'Amazon', value: 'Amazon' },
  { label: '独立站', value: '独立站' },
  { label: '淘宝', value: '淘宝' },
  { label: '小红书', value: '小红书' },
  { label: '信息流广告', value: '信息流广告' },
]

const roleOptions = [
  { label: '主图', value: '主图' },
  { label: '副图', value: '副图' },
  { label: '卖点图', value: '卖点图' },
  { label: '痛点图', value: '痛点图' },
  { label: '机制图', value: '机制图' },
  { label: '对比图', value: '对比图' },
  { label: '证据图', value: '证据图' },
  { label: 'SKU 组合图', value: 'SKU 组合图' },
  { label: '详情页切片', value: '详情页切片' },
  { label: '广告首帧', value: '广告首帧' },
]

const ratioOptions = [
  { label: '1:1 方图', value: '1:1' },
  { label: '4:5 竖图', value: '4:5' },
  { label: '3:4 竖图', value: '3:4' },
  { label: '9:16 短视频首帧', value: '9:16' },
  { label: '16:9 横图', value: '16:9' },
]

function updateForm<K extends keyof SopForm>(form: SopForm, key: K, value: SopForm[K]) {
  return { ...form, [key]: value }
}

function normalizeValue(value: string, fallback = '未提供') {
  return value.trim() || fallback
}

function buildMissingFields(form: SopForm, imageCount: number) {
  const missing: string[] = []
  if (!imageCount && !form.competitorDescription.trim()) missing.push('竞品图或图片说明')
  if (!form.productName.trim()) missing.push('自家产品名称')
  if (!form.sellingPoints.trim()) missing.push('自家产品核心卖点')
  if (!form.audience.trim()) missing.push('目标人群')
  return missing
}

function getPlatformGuard(platform: string, role: string) {
  if (platform === 'TikTok Shop') {
    if (role === '主图') {
      return 'TikTok Shop 主图优先真实产品、白底或极浅背景、主体清晰，不要生成促销字、贴纸、水印、边框、证书、价格、评分或平台标识。'
    }
    return 'TikTok Shop 商品图需要移动端清晰、产品真实、卖点克制，不要伪装用户评价，不要生成未经证实的功效、达人背书或平台背书。'
  }
  if (platform === 'Amazon') {
    return 'Amazon 方向需要保持商品货架逻辑，主图偏白底产品真实，副图可展示卖点、场景、尺寸、机制、对比和证据，不要混入 TikTok 短视频话术。'
  }
  if (platform === '信息流广告') {
    return '信息流广告优先第一眼钩子、场景冲突、产品出现位置和行动暗示，但不要伪装真实评价、虚构达人背书或夸张承诺。'
  }
  return '按目标平台的电商素材逻辑处理，先保证产品真实和信息可信，再迁移竞品的构图与表达路径。'
}

function buildSopPrompt(form: SopForm, imageCount: number) {
  const missing = buildMissingFields(form, imageCount)
  const evidence = normalizeValue(form.evidence, '无')
  const forbidden = normalizeValue(
    form.forbidden,
    '不要出现竞品品牌、未经证实的数据、医疗功效、绝对化承诺、乱码中文、假证书、假报告、假 logo',
  )

  return `请根据我提供的竞品图片、图片说明和自家产品资料，按“电商图片拆解反推 SOP”完成真实 AI 分析，而不是套固定模板。

核心原则：
1. 先判断图片解决的购买疑问，再分析画面风格。
2. 只迁移结构、表达逻辑、信息层级和构图方法，不照搬竞品品牌、包装、文案、证书、价格、功效数字、人物身份或平台标识。
3. 资料不足时要明确标注缺少信息，不要编造产品功效、检测报告、认证、销量或用户评价。
4. 最终生图提示词必须是英文，并且不能混入中文分析内容。

输入信息：
竞品图片数量：${imageCount}
竞品图片或图片说明：
${normalizeValue(form.competitorDescription)}

目标平台：${form.targetPlatform}
目标图位：${form.imageRole}
希望生成比例：${form.ratio}
自家产品名称：${normalizeValue(form.productName)}
自家产品品类：${normalizeValue(form.category)}
自家产品核心卖点：
${normalizeValue(form.sellingPoints)}

目标人群：
${normalizeValue(form.audience)}

真实证据：
${evidence}

不能出现的表达：
${forbidden}

平台约束：
${getPlatformGuard(form.targetPlatform, form.imageRole)}

请严格按下面结构输出：
## 1. 图位判断
判断竞品图属于哪类图，并说明依据。
## 2. 平台适配判断
判断它更像货架电商图、详情页说明图、TikTok Shop 商品图、TikTok 信息流广告还是社媒种草图。说明迁移到目标平台时需要保留、删除、改弱的内容。
## 3. 购买疑问
判断这张图主要回答用户哪一个问题：这是什么、适合我吗、为什么有效、比普通产品好在哪里、有没有证据、怎么用、买哪款、为什么现在要点击或下单。
## 4. 信息层级
用第一层、第二层、第三层、弱化信息拆出画面优先级。
## 5. 画面结构
拆出产品位置、产品占比、背景、文字区域、视觉动线、留白方式、色彩和光线。
## 6. 可迁移部分
列出可以用于自家产品的结构，并说明为什么适合。
## 7. 不能照搬部分
列出必须替换或删除的品牌、包装、文案、证书、报告、价格、功效数字、人物、场景、平台标识和其他风险。
## 8. 自家产品迁移方案
输出画面目标、核心卖点、推荐构图、推荐场景、推荐信息层级、需要后期添加的文字或证据、需要避免的风险。
## 9. English AI Image Prompt
Output one polished English prompt that can be copied directly into an image generation model. It must include aspect ratio, target platform, image role, visual task, product subject, composition, background or scene, reserved areas for post-added text, lighting, texture, realism requirements, and prohibitions. Do not include Chinese text in this prompt.
## 10. English Negative Prompt
Output one English negative prompt only. Avoid product deformation, garbled text, fake certificates, fake reports, fake logos, exaggerated claims, wrong SKU quantity, copied competitor elements, platform marks, watermark, price tags, ratings, and unsupported medical or performance claims.
## 11. 生成后检查清单
检查产品是否变形、包装是否正确、颜色是否偏差、SKU 数量是否正确、是否生成乱码文字、是否出现假证书或假报告、是否出现未经证实的功效数字、是否照搬竞品元素、是否符合目标平台图位、画面是否解决原本的购买疑问。
## 12. 缺少信息
${missing.length ? `当前已知缺少：${missing.join('、')}。如果缺少信息会影响判断，请先提醒我补充。` : '如果资料足够，请写“暂无”。'}`
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function SopReverseWorkspace() {
  const form = useStore((s) => s.sopDraft.form)
  const referenceImages = useStore((s) => s.sopDraft.referenceImages)
  const output = useStore((s) => s.sopDraft.output)
  const error = useStore((s) => s.sopDraft.error)
  const setSopDraft = useStore((s) => s.setSopDraft)
  const resetSopDraft = useStore((s) => s.resetSopDraft)
  const isAnalyzing = useStore((s) => s.sopDraft.analysisStatus === 'running')
  const [showPromptModal, setShowPromptModal] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const settings = useStore((s) => s.settings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const showToast = useStore((s) => s.showToast)
  const setForm = (nextForm: SopForm) => setSopDraft({ form: nextForm })
  const setError = (nextError: string) => setSopDraft({ error: nextError })

  const reverseProfile = getSopReverseProfile(settings)
  const profileValidation = (reverseProfile ? validateApiProfile(reverseProfile) : '未选择拆图反推 AI 配置') ?? ''
  const generatedPrompt = useMemo(() => buildSopPrompt(form, referenceImages.length), [form, referenceImages.length])
  const englishPrompt = useMemo(() => (output ? extractEnglishImagePrompt(output) : ''), [output])
  const missingFields = useMemo(() => buildMissingFields(form, referenceImages.length), [form, referenceImages.length])

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    if (!isDragging) setIsDragging(true)
  }

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setIsDragging(false)
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setIsDragging(false)
    if (event.dataTransfer.files?.length) {
      void addImages(event.dataTransfer.files)
    }
  }

  const addImages = async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'))
    if (!imageFiles.length) return
    const slots = Math.max(0, MAX_REFERENCE_IMAGES - referenceImages.length)
    const selected = imageFiles.slice(0, slots)
    if (!selected.length) {
      showToast(`最多上传 ${MAX_REFERENCE_IMAGES} 张竞品图`, 'error')
      return
    }

    const nextImages = await Promise.all(
      selected.map(async (file) => {
        const dataUrl = await fileToDataUrl(file)
        const id = await storeImage(dataUrl, 'upload')
        return { id, name: file.name, dataUrl }
      }),
    )
    setSopDraft({ referenceImages: [...referenceImages, ...nextImages] })
    if (imageFiles.length > selected.length) showToast(`已保留前 ${MAX_REFERENCE_IMAGES} 张图片`, 'info')
  }

  const removeImage = (id: string) => {
    setSopDraft({ referenceImages: referenceImages.filter((image) => image.id !== id) })
  }

  const analyzeWithAi = async () => {
    if (!reverseProfile || profileValidation) {
      setError(profileValidation)
      showToast(`请先配置拆图反推 AI：${profileValidation}`, 'error')
      setShowSettings(true, 'api')
      return
    }

    const analysis = startWorkspaceAnalysis('sop')
    const controller = analysis.controller
    setSopDraft({
      analysisStatus: 'running',
      analysisRequestId: analysis.requestId,
      analysisStartedAt: Date.now(),
      analysisOperation: 'analyze',
    })
    setError('')

    try {
      const result = await callSopReverseApi({
        profile: reverseProfile,
        prompt: generatedPrompt,
        images: referenceImages.map((image) => ({ dataUrl: image.dataUrl, name: image.name })),
        signal: controller.signal,
      })
      if (!isWorkspaceAnalysisCurrent('sop', analysis.requestId)) return
      setSopDraft({
        output: result,
        error: '',
        analysisStatus: 'done',
        analysisRequestId: null,
        analysisOperation: null,
      })
      showToast('AI 拆解反推已完成', 'success')
    } catch (err) {
      if (controller.signal.aborted) return
      const message = err instanceof Error ? err.message : String(err)
      if (isWorkspaceAnalysisCurrent('sop', analysis.requestId)) {
        setSopDraft({ error: message, analysisStatus: 'error', analysisRequestId: null, analysisOperation: null })
      }
      showToast(`拆图反推失败：${message}`, 'error')
    } finally {
      finishWorkspaceAnalysis('sop', analysis.requestId)
    }
  }

  const stopAnalyze = () => {
    const requestId = stopWorkspaceAnalysis('sop')
    if (requestId) setSopDraft({ analysisStatus: 'stopped', analysisRequestId: null, analysisOperation: null })
    showToast('已停止拆图反推', 'info')
  }

  const openEnglishPromptModal = () => {
    if (!englishPrompt.trim()) {
      showToast('模型未输出英文提示词章节，请先确认分析结果后再复制', 'error')
      return
    }

    setShowPromptModal(true)
  }

  const copyEnglishPrompt = async () => {
    if (!englishPrompt.trim()) {
      showToast('模型未输出英文提示词章节，不能复制整份中文分析', 'error')
      return
    }
    try {
      await copyTextToClipboard(englishPrompt)
      showToast('英文提示词已复制', 'success')
    } catch (err) {
      showToast(getClipboardFailureMessage('复制英文提示词失败', err), 'error')
    }
  }

  const resetForm = () => {
    stopWorkspaceAnalysis('sop')
    resetSopDraft()
    setShowPromptModal(false)
    showToast('SOP 表单已重置', 'info')
  }

  return (
    <div data-no-drag-select className="animate-fade-up space-y-4 pb-8">
      <div className="ui-panel flex flex-col gap-3 px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="ui-page-icon h-10 w-10 rounded-xl" aria-hidden="true">
            <ScanIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="ui-title text-lg">电商图片拆解反推 SOP</h2>
              <span className={`ui-badge ${profileValidation ? 'ui-badge-warning' : 'ui-badge-success'}`}>
                <span className="ui-dot" />
                {profileValidation ? '拆图 AI 待配置' : reverseProfile?.model || '已连接'}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-[var(--text-3)]">
              上传竞品图并补充自家产品资料，AI 自动拆解画面结构、迁移方案与英文生图提示词
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {reverseProfile && (
            <span className="hidden max-w-[200px] truncate text-xs text-[var(--text-3)] xl:inline">
              {reverseProfile.name}
            </span>
          )}
          <button type="button" onClick={() => setShowSettings(true, 'api')} className="ui-btn ui-btn-sm h-9">
            <SettingsIcon className="h-3.5 w-3.5" />
            配置拆图 AI
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[372px_minmax(0,1fr)]">
        <aside className="space-y-4 xl:sticky xl:top-[68px] xl:self-start">
          <section
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`ui-panel p-4 transition ${
              isDragging ? 'border-[var(--accent)] ring-2 ring-[var(--accent-ring)]' : ''
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) void addImages(event.target.files)
                event.currentTarget.value = ''
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-[var(--text-1)]">
                  竞品图
                  <span className="ml-1.5 font-mono text-xs font-medium text-[var(--text-3)]">
                    {referenceImages.length}/{MAX_REFERENCE_IMAGES}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-[var(--text-3)]">拖拽或点击上传，AI 直接看图拆解</div>
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="ui-btn ui-btn-soft ui-btn-sm h-8"
              >
                <ImportIcon className="h-3.5 w-3.5" />
                上传竞品图
              </button>
            </div>

            {referenceImages.length === 0 ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                data-dragging={isDragging ? 'true' : undefined}
                className="ui-dropzone mt-3 min-h-[126px] w-full"
              >
                <span className="ui-dropzone-icon h-10 w-10 rounded-xl" aria-hidden="true">
                  <UploadCloudIcon className="h-5 w-5" />
                </span>
                <span className="text-sm font-semibold text-[var(--text-1)]">
                  {isDragging ? '松开鼠标以上传竞品图' : '拖入或选择竞品图片'}
                </span>
                <span className="text-xs text-[var(--text-3)]">最多 8 张 · 没图也可在右侧文字描述</span>
              </button>
            ) : (
              <div className="mt-3 grid grid-cols-3 gap-2">
                {referenceImages.map((image) => (
                  <div
                    key={image.id}
                    className="group relative overflow-hidden rounded-xl bg-[var(--surface-solid)] shadow-[0_0_0_1px_var(--line)]"
                  >
                    <img
                      src={image.dataUrl}
                      alt={image.name}
                      className="aspect-square w-full object-cover transition duration-300 group-hover:scale-105"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(image.id)}
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/65 text-white opacity-100 backdrop-blur-sm transition hover:bg-red-500 sm:opacity-0 sm:group-hover:opacity-100"
                      aria-label="移除图片"
                    >
                      <CloseIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="ui-panel space-y-3.5 p-4">
            <div className="text-sm font-bold text-[var(--text-1)]">迁移目标规格</div>
            <div className="grid gap-3">
              <label>
                <span className={LABEL_CLASS}>目标平台</span>
                <Select
                  value={form.targetPlatform}
                  onChange={(value) => setForm(updateForm(form, 'targetPlatform', String(value)))}
                  options={platformOptions}
                  className="ui-input h-9"
                />
              </label>
              <div className="grid grid-cols-2 gap-2.5">
                <label>
                  <span className={LABEL_CLASS}>目标图位</span>
                  <Select
                    value={form.imageRole}
                    onChange={(value) => setForm(updateForm(form, 'imageRole', String(value)))}
                    options={roleOptions}
                    className="ui-input h-9"
                  />
                </label>
                <label>
                  <span className={LABEL_CLASS}>生成比例</span>
                  <Select
                    value={form.ratio}
                    onChange={(value) => setForm(updateForm(form, 'ratio', String(value)))}
                    options={ratioOptions}
                    className="ui-input h-9"
                  />
                </label>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-inset)] px-3 py-2 text-xs text-[var(--text-2)]">
              {missingFields.length === 0 ? (
                <span className="font-medium text-emerald-600 dark:text-emerald-400">核心资料完整，可直接开始 AI 拆解反推</span>
              ) : (
                <span>建议补充：{missingFields.join('、')}</span>
              )}
            </div>

            <div className="space-y-2 border-t border-[var(--line)] pt-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void analyzeWithAi()}
                  disabled={isAnalyzing}
                  className="ui-btn ui-btn-primary h-10 flex-1 text-sm"
                >
                  {isAnalyzing ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70" />
                  ) : (
                    <EditIcon className="h-4 w-4" />
                  )}
                  {isAnalyzing ? 'AI 分析中' : 'AI 拆解反推'}
                </button>
                {isAnalyzing && (
                  <button type="button" onClick={stopAnalyze} className="ui-btn ui-btn-danger-soft h-10 px-3.5 text-sm">
                    停止
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={openEnglishPromptModal}
                  disabled={!englishPrompt.trim() || isAnalyzing}
                  className="ui-btn ui-btn-sm h-9"
                >
                  <EyeIcon className="h-3.5 w-3.5" />
                  查看完整提示词
                </button>
                <button
                  type="button"
                  onClick={() => void copyEnglishPrompt()}
                  disabled={!englishPrompt.trim() || isAnalyzing}
                  className="ui-btn ui-btn-sm h-9"
                >
                  <CopyIcon className="h-3.5 w-3.5" />
                  复制英文提示词
                </button>
              </div>
              <button type="button" onClick={resetForm} className="ui-btn ui-btn-ghost ui-btn-sm h-8 w-full">
                <RefreshIcon className="h-3.5 w-3.5" />
                重置表单
              </button>
            </div>
          </section>
        </aside>

        <div className="min-w-0 space-y-4">
          {error && (
            <div data-selectable-text className="ui-callout ui-callout-danger text-xs">
              {error}
            </div>
          )}

          {output && (
            <section className="ui-panel overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-5 py-3.5">
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-1)]">AI 拆解分析报告</h3>
                  <p className="mt-0.5 text-xs text-[var(--text-3)]">包含 12 项完整结构拆解、迁移方案与中英文提示词</p>
                </div>
                {englishPrompt && (
                  <button type="button" onClick={() => void copyEnglishPrompt()} className="ui-btn ui-btn-soft ui-btn-sm">
                    <CopyIcon className="h-3.5 w-3.5" />
                    复制提示词
                  </button>
                )}
              </div>
              <div data-selectable-text className="custom-scrollbar max-h-[540px] overflow-auto p-5 text-sm leading-7">
                <MarkdownRenderer content={output} />
              </div>
            </section>
          )}

          <section className="ui-panel space-y-5 p-5">
            <div>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="ui-section-title">竞品画面观察</h3>
                <span className="text-xs text-[var(--text-3)]">选填 · 补充文字与卖点细节</span>
              </div>
              <label className="block">
                <span className={LABEL_CLASS}>竞品图片说明</span>
                <textarea
                  value={form.competitorDescription}
                  onChange={(event) => setForm(updateForm(form, 'competitorDescription', event.target.value))}
                  className={`${FIELD_CLASS} min-h-[96px] resize-y`}
                  placeholder="可补充图片中难以识别的文字、卖点、证书、场景、价格、品牌风险等。"
                />
              </label>
            </div>

            <div className="border-t border-[var(--line)] pt-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="ui-section-title">自家产品定位</h3>
                <span className="text-xs text-[var(--text-3)]">用于把竞品结构精准迁移到你的产品</span>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label>
                  <span className={LABEL_CLASS}>自家产品名称</span>
                  <input
                    value={form.productName}
                    onChange={(event) => setForm(updateForm(form, 'productName', event.target.value))}
                    className={FIELD_CLASS}
                    placeholder="例如 便携式宠物饮水杯"
                  />
                </label>
                <label>
                  <span className={LABEL_CLASS}>自家产品品类</span>
                  <input
                    value={form.category}
                    onChange={(event) => setForm(updateForm(form, 'category', event.target.value))}
                    className={FIELD_CLASS}
                    placeholder="例如 宠物外出用品"
                  />
                </label>
                <label>
                  <span className={LABEL_CLASS}>自家产品核心卖点</span>
                  <textarea
                    value={form.sellingPoints}
                    onChange={(event) => setForm(updateForm(form, 'sellingPoints', event.target.value))}
                    className={`${FIELD_CLASS} min-h-[100px] resize-y`}
                    placeholder="逐条写真卖点，例如材质、尺寸、结构、套装内容、使用场景。"
                  />
                </label>
                <label>
                  <span className={LABEL_CLASS}>目标人群</span>
                  <textarea
                    value={form.audience}
                    onChange={(event) => setForm(updateForm(form, 'audience', event.target.value))}
                    className={`${FIELD_CLASS} min-h-[100px] resize-y`}
                    placeholder="例如 美国养小型犬的通勤用户，关注便携、防漏、易清洗。"
                  />
                </label>
              </div>
            </div>

            <div className="border-t border-[var(--line)] pt-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="ui-section-title">真实证据与合规边界</h3>
                <span className="text-xs text-[var(--text-3)]">避免虚假背书与平台违规风险</span>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label>
                  <span className={LABEL_CLASS}>真实证据</span>
                  <textarea
                    value={form.evidence}
                    onChange={(event) => setForm(updateForm(form, 'evidence', event.target.value))}
                    className={`${FIELD_CLASS} min-h-[84px] resize-y`}
                    placeholder="检测报告、认证、规格、材质、使用数据。没有就写无。"
                  />
                </label>
                <label>
                  <span className={LABEL_CLASS}>不能出现的表达</span>
                  <textarea
                    value={form.forbidden}
                    onChange={(event) => setForm(updateForm(form, 'forbidden', event.target.value))}
                    className={`${FIELD_CLASS} min-h-[84px] resize-y`}
                    placeholder="平台禁词、医疗功效、绝对化承诺、竞品品牌、价格、未经证实数据。"
                  />
                </label>
              </div>
            </div>
          </section>
        </div>
      </div>

      {showPromptModal &&
        englishPrompt &&
        createPortal(
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-6">
            <div className="ui-backdrop animate-overlay-in absolute inset-0" onClick={() => setShowPromptModal(false)} />
            <div
              className="ui-modal animate-modal-in relative z-10 flex h-[72vh] w-full max-w-3xl flex-col"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
                <div className="min-w-0">
                  <div className="text-base font-bold text-[var(--text-1)]">英文提示词</div>
                  <div className="mt-0.5 truncate text-xs text-[var(--text-3)]">
                    可复制到图片生成输入框，配合参考图使用
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" onClick={() => void copyEnglishPrompt()} className="ui-btn ui-btn-primary ui-btn-sm">
                    <CopyIcon className="h-3.5 w-3.5" />
                    复制
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPromptModal(false)}
                    className="ui-icon-btn ui-icon-btn-sm"
                    aria-label="关闭英文提示词窗口"
                  >
                    <CloseIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="custom-scrollbar min-h-0 flex-1 overflow-auto p-5">
                <pre
                  data-selectable-text
                  className="whitespace-pre-wrap break-words font-mono text-[13px] leading-7 text-[var(--text-1)]"
                >
                  {englishPrompt}
                </pre>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
