import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { getSopReverseProfile, validateApiProfile } from '../lib/apiProfiles'
import { callSopReverseApi } from '../lib/sopReverseApi'
import { copyTextToClipboard, getClipboardFailureMessage } from '../lib/clipboard'
import Select from './Select'
import { CloseIcon, CopyIcon, EditIcon, EyeIcon, ImportIcon, RefreshIcon, SettingsIcon } from './icons'

type SopForm = {
  competitorDescription: string
  targetPlatform: string
  imageRole: string
  productName: string
  category: string
  sellingPoints: string
  audience: string
  evidence: string
  forbidden: string
  ratio: string
}

type SopReferenceImage = {
  id: string
  name: string
  dataUrl: string
}

const FIELD_CLASS = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-100 dark:placeholder:text-gray-500'
const LABEL_CLASS = 'mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400'
const MAX_REFERENCE_IMAGES = 8

const DEFAULT_FORM: SopForm = {
  competitorDescription: '',
  targetPlatform: 'TikTok Shop',
  imageRole: '卖点图',
  productName: '',
  category: '',
  sellingPoints: '',
  audience: '',
  evidence: '',
  forbidden: '',
  ratio: '1:1',
}

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
  const forbidden = normalizeValue(form.forbidden, '不要出现竞品品牌、未经证实的数据、医疗功效、绝对化承诺、乱码中文、假证书、假报告、假 logo')

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

function extractEnglishPrompt(text: string) {
  const promptMatch = text.match(/(?:^|\n)#{1,3}\s*(?:9[.、]?\s*)?(?:English\s+AI\s+Image\s+Prompt|英文\s*AI\s*图片提示词)[^\n]*\n([\s\S]*?)(?=\n#{1,3}\s*(?:10|English\s+Negative\s+Prompt|负面)|$)/i)
  const direct = promptMatch?.[1]?.trim()
  if (direct) return direct.replace(/^```[a-z]*\s*/i, '').replace(/```$/i, '').trim()
  return text.trim()
}

function createImageId() {
  return `sop-img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export default function SopReverseWorkspace() {
  const [form, setForm] = useState<SopForm>(DEFAULT_FORM)
  const [referenceImages, setReferenceImages] = useState<SopReferenceImage[]>([])
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [showPromptModal, setShowPromptModal] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const settings = useStore((s) => s.settings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const showToast = useStore((s) => s.showToast)

  const reverseProfile = getSopReverseProfile(settings)
  const profileValidation = (reverseProfile ? validateApiProfile(reverseProfile) : '未选择拆图反推 AI 配置') ?? ''
  const generatedPrompt = useMemo(() => buildSopPrompt(form, referenceImages.length), [form, referenceImages.length])
  const englishPrompt = useMemo(() => output ? extractEnglishPrompt(output) : '', [output])

  const addImages = async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'))
    if (!imageFiles.length) return
    const slots = Math.max(0, MAX_REFERENCE_IMAGES - referenceImages.length)
    const selected = imageFiles.slice(0, slots)
    if (!selected.length) {
      showToast(`最多上传 ${MAX_REFERENCE_IMAGES} 张竞品图`, 'error')
      return
    }

    const nextImages = await Promise.all(selected.map(async (file) => ({
      id: createImageId(),
      name: file.name,
      dataUrl: await fileToDataUrl(file),
    })))
    setReferenceImages((current) => [...current, ...nextImages])
    if (imageFiles.length > selected.length) showToast(`已保留前 ${MAX_REFERENCE_IMAGES} 张图片`, 'info')
  }

  const removeImage = (id: string) => {
    setReferenceImages((current) => current.filter((image) => image.id !== id))
  }

  const analyzeWithAi = async () => {
    if (!reverseProfile || profileValidation) {
      setError(profileValidation)
      showToast(`请先配置拆图反推 AI：${profileValidation}`, 'error')
      setShowSettings(true, 'api')
      return
    }

    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller
    setIsAnalyzing(true)
    setError('')

    try {
      const result = await callSopReverseApi({
        profile: reverseProfile,
        prompt: generatedPrompt,
        images: referenceImages.map((image) => ({ dataUrl: image.dataUrl, name: image.name })),
        signal: controller.signal,
      })
      setOutput(result)
      showToast('AI 拆解反推已完成', 'success')
    } catch (err) {
      if (controller.signal.aborted) return
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      showToast(`拆图反推失败：${message}`, 'error')
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null
      setIsAnalyzing(false)
    }
  }

  const stopAnalyze = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsAnalyzing(false)
    showToast('已停止拆图反推', 'info')
  }

  const openEnglishPromptModal = () => {
    if (!englishPrompt.trim()) {
      showToast('请先完成 AI 拆解反推，并确认结果中包含英文提示词', 'error')
      return
    }

    setShowPromptModal(true)
  }

  const copyEnglishPrompt = async () => {
    if (!englishPrompt.trim()) {
      showToast('请先完成 AI 拆解反推，再复制英文提示词', 'error')
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
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setForm(DEFAULT_FORM)
    setReferenceImages([])
    setOutput('')
    setError('')
    setIsAnalyzing(false)
    setShowPromptModal(false)
    showToast('SOP 表单已重置', 'info')
  }

  return (
    <section data-no-drag-select className="mt-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-gray-900">
      <div className="border-b border-gray-200 bg-gray-50/80 p-4 dark:border-white/[0.08] dark:bg-gray-950/70 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="inline-flex rounded-xl border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-200">
              独立 AI 分析板块
            </div>
            <h2 className="mt-3 text-xl font-black tracking-tight text-gray-950 dark:text-gray-50 sm:text-2xl">
              电商图片拆解反推 SOP
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-500 dark:text-gray-400">
              竞品图、商品资料和 SOP 会一起发送给拆图反推模型，由 AI 输出中文拆解、迁移方案、英文生图提示词和英文负面提示词。
            </p>
          </div>
          <div className="grid min-w-[240px] gap-2 rounded-xl border border-gray-200 bg-white p-3 dark:border-white/[0.08] dark:bg-gray-900">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-gray-700 dark:text-gray-200">拆图 AI</span>
              <span className={profileValidation ? 'text-amber-600 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-300'}>
                {profileValidation ? '待配置' : '已连接'}
              </span>
            </div>
            <div className="min-w-0 text-[12px] text-gray-500 dark:text-gray-400">
              {reverseProfile ? `${reverseProfile.name} · ${reverseProfile.model}` : '未选择模型'}
            </div>
            <button
              type="button"
              onClick={() => setShowSettings(true, 'api')}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 text-xs font-medium text-gray-700 transition hover:bg-white dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/[0.06]"
            >
              <SettingsIcon className="h-3.5 w-3.5" />
              配置拆图 AI
            </button>
          </div>
        </div>
      </div>

      <div>
        <div className="p-4 sm:p-5">
          <div className="mb-4 rounded-xl border border-dashed border-gray-300 bg-gray-50/80 p-3 dark:border-white/[0.12] dark:bg-gray-950/40">
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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">竞品图</div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">可上传多张，AI 会直接看图拆解；没有图片时可填写图片说明。</div>
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/[0.06]"
              >
                <ImportIcon className="h-4 w-4" />
                上传竞品图
              </button>
            </div>
            {referenceImages.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                {referenceImages.map((image) => (
                  <div key={image.id} className="group relative overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-gray-900">
                    <img src={image.dataUrl} alt={image.name} className="aspect-square w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeImage(image.id)}
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition group-hover:opacity-100"
                      aria-label="移除图片"
                    >
                      <CloseIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <label className="xl:col-span-2">
              <span className={LABEL_CLASS}>竞品图片说明</span>
              <textarea
                value={form.competitorDescription}
                onChange={(event) => setForm((current) => updateForm(current, 'competitorDescription', event.target.value))}
                className={`${FIELD_CLASS} min-h-[112px] resize-y`}
                placeholder="可补充图片中难以识别的文字、卖点、证书、场景、价格、品牌风险等。"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-3 xl:col-span-2">
              <label>
                <span className={LABEL_CLASS}>目标平台</span>
                <Select
                  value={form.targetPlatform}
                  onChange={(value) => setForm((current) => updateForm(current, 'targetPlatform', String(value)))}
                  options={platformOptions}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none transition hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-white/[0.06]"
                />
              </label>
              <label>
                <span className={LABEL_CLASS}>目标图位</span>
                <Select
                  value={form.imageRole}
                  onChange={(value) => setForm((current) => updateForm(current, 'imageRole', String(value)))}
                  options={roleOptions}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none transition hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-white/[0.06]"
                />
              </label>
              <label>
                <span className={LABEL_CLASS}>生成比例</span>
                <Select
                  value={form.ratio}
                  onChange={(value) => setForm((current) => updateForm(current, 'ratio', String(value)))}
                  options={ratioOptions}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none transition hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-100 dark:hover:bg-white/[0.06]"
                />
              </label>
            </div>

            <label>
              <span className={LABEL_CLASS}>自家产品名称</span>
              <input
                value={form.productName}
                onChange={(event) => setForm((current) => updateForm(current, 'productName', event.target.value))}
                className={FIELD_CLASS}
                placeholder="例如 便携式宠物饮水杯"
              />
            </label>
            <label>
              <span className={LABEL_CLASS}>自家产品品类</span>
              <input
                value={form.category}
                onChange={(event) => setForm((current) => updateForm(current, 'category', event.target.value))}
                className={FIELD_CLASS}
                placeholder="例如 宠物外出用品"
              />
            </label>

            <label>
              <span className={LABEL_CLASS}>自家产品核心卖点</span>
              <textarea
                value={form.sellingPoints}
                onChange={(event) => setForm((current) => updateForm(current, 'sellingPoints', event.target.value))}
                className={`${FIELD_CLASS} min-h-[92px] resize-y`}
                placeholder="逐条写真卖点，例如材质、尺寸、结构、套装内容、使用场景。"
              />
            </label>
            <label>
              <span className={LABEL_CLASS}>目标人群</span>
              <textarea
                value={form.audience}
                onChange={(event) => setForm((current) => updateForm(current, 'audience', event.target.value))}
                className={`${FIELD_CLASS} min-h-[92px] resize-y`}
                placeholder="例如 美国养小型犬的通勤用户，关注便携、防漏、易清洗。"
              />
            </label>

            <label>
              <span className={LABEL_CLASS}>真实证据</span>
              <textarea
                value={form.evidence}
                onChange={(event) => setForm((current) => updateForm(current, 'evidence', event.target.value))}
                className={`${FIELD_CLASS} min-h-[76px] resize-y`}
                placeholder="检测报告、认证、规格、材质、使用数据。没有就写无。"
              />
            </label>
            <label>
              <span className={LABEL_CLASS}>不能出现的表达</span>
              <textarea
                value={form.forbidden}
                onChange={(event) => setForm((current) => updateForm(current, 'forbidden', event.target.value))}
                className={`${FIELD_CLASS} min-h-[76px] resize-y`}
                placeholder="平台禁词、医疗功效、绝对化承诺、竞品品牌、价格、未经证实数据。"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void analyzeWithAi()}
              disabled={isAnalyzing}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-500 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isAnalyzing ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <EditIcon className="h-4 w-4" />
              )}
              {isAnalyzing ? 'AI 分析中' : 'AI 拆解反推'}
            </button>
            {isAnalyzing && (
              <button
                type="button"
                onClick={stopAnalyze}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 active:translate-y-px dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/[0.06]"
              >
                停止
              </button>
            )}
            <button
              type="button"
              onClick={openEnglishPromptModal}
              disabled={!englishPrompt.trim() || isAnalyzing}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/[0.06]"
            >
              <EyeIcon className="h-4 w-4" />
              查看完整提示词
            </button>
            <button
              type="button"
              onClick={() => void copyEnglishPrompt()}
              disabled={!englishPrompt.trim() || isAnalyzing}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/[0.06]"
            >
              <CopyIcon className="h-4 w-4" />
              复制英文提示词
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 active:translate-y-px dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
            >
              <RefreshIcon className="h-4 w-4" />
              重置
            </button>
          </div>
          {error && (
            <div data-selectable-text className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-600 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-200">
              {error}
            </div>
          )}
        </div>

      </div>
      {showPromptModal && englishPrompt && createPortal(
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-6">
          <div
            className="absolute inset-0 bg-black/35 backdrop-blur-md"
            onClick={() => setShowPromptModal(false)}
          />
          <div
            className="relative z-10 flex h-[72vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-white/70 bg-white shadow-2xl ring-1 ring-black/10 dark:border-white/[0.08] dark:bg-gray-900 dark:ring-white/10"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex min-h-0 w-full flex-col bg-white dark:bg-gray-900">
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-white/[0.08]">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">英文提示词</div>
                  <div className="mt-0.5 truncate text-xs text-gray-500 dark:text-gray-400">
                    可复制到图片生成输入框，配合参考图使用
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void copyEnglishPrompt()}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 active:translate-y-px dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                  >
                    <CopyIcon className="h-3.5 w-3.5" />
                    复制
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPromptModal(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
                    aria-label="关闭英文提示词窗口"
                  >
                    <CloseIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-4 custom-scrollbar">
                <pre data-selectable-text className="whitespace-pre-wrap break-words font-sans text-[13px] leading-7 text-gray-800 dark:text-gray-100">
                  {englishPrompt}
                </pre>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  )
}
