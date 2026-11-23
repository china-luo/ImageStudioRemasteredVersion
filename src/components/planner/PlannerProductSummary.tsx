import { useState } from 'react'
import type { AmazonPromptDraft } from '../../lib/amazonPrompt'

type ProductSummaryField = {
  key: keyof Omit<AmazonPromptDraft, 'kind'>
  label: string
  usage: 'workflow' | 'display'
  note: string
  multiline?: boolean
  wide?: boolean
}

const PRODUCT_SUMMARY_FIELDS: ProductSummaryField[] = [
  {
    key: 'productTitle',
    label: '商品标题',
    usage: 'workflow',
    note: '用于策划历史名称、生成任务归类和同一商品任务匹配；不会单独追加到生图提示词。',
  },
  {
    key: 'category',
    label: '类目',
    usage: 'workflow',
    note: '再次发起 Listing、A+ 或 TikTok 策划时，会作为已知类目传给策划模型；不直接传给图片模型。',
  },
  {
    key: 'brand',
    label: '品牌 / 型号',
    usage: 'workflow',
    note: '再次发起 A+ 策划时，会作为真实品牌或型号参考；Listing、TikTok 和图片生成不直接读取。',
  },
  {
    key: 'color',
    label: '颜色',
    usage: 'display',
    note: '仅用于结果核对和策划历史恢复；该字段值不会再次传给策划或图片模型。',
  },
  {
    key: 'material',
    label: '材质 / 表面工艺',
    usage: 'display',
    note: '仅用于结果核对和策划历史恢复；该字段值不会再次传给策划或图片模型。',
  },
  {
    key: 'audience',
    label: '目标人群',
    usage: 'display',
    note: '仅用于结果核对和策划历史恢复；该字段值不会再次传给策划或图片模型。',
  },
  {
    key: 'sellingPoints',
    label: '卖点',
    usage: 'display',
    note: '展示模型从 Listing 归纳的卖点并随历史保存；此处的字段副本不参与后续提示词拼装。',
    multiline: true,
    wide: true,
  },
  {
    key: 'packageIncludes',
    label: '包装清单',
    usage: 'display',
    note: '仅用于核对模型识别结果和历史恢复；该字段值不会直接约束图片生成。',
    multiline: true,
  },
]

const READ_ONLY_FIELD_CLASS =
  'w-full cursor-text rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--surface-inset)] px-3 py-2 text-sm text-[var(--text-1)] outline-none placeholder:text-[var(--text-3)] focus:border-[var(--line-strong)] focus:ring-0'

export default function PlannerProductSummary({ draft }: { draft: AmazonPromptDraft }) {
  const [expandedField, setExpandedField] = useState<ProductSummaryField['key'] | null>(null)

  return (
    <section
      className="mt-2 border-t border-[var(--line)] pt-4"
      aria-labelledby="product-summary-title"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="product-summary-title" className="text-sm font-semibold text-[var(--text-1)]">
          AI 商品信息摘要
        </h3>
        <span className="ui-badge">只读</span>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-3)]">
        以下内容由最近一次 AI
        策划返回，用于核对结果和恢复策划历史。字段旁的标记说明返回后是否仍被工作流读取，点击信息图标可查看具体用途；如需调整商品事实，请修改上方标题、五点描述或参考图后重新策划。
      </p>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-2)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          涉及工作流逻辑
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-gray-400" />
          仅展示与历史保存
        </span>
      </div>

      <div className="mt-4 grid gap-3.5 md:grid-cols-2">
        {PRODUCT_SUMMARY_FIELDS.map((field) => {
          const descriptionId = `product-summary-${field.key}-description`
          const value = draft[field.key]
          const descriptionExpanded = expandedField === field.key

          return (
            <div key={field.key} className={field.wide ? 'md:col-span-2' : ''}>
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-[var(--text-2)]">{field.label}</span>
                <span className={`ui-badge h-5 px-1.5 text-[10px] ${field.usage === 'workflow' ? 'ui-badge-success' : ''}`}>
                  {field.usage === 'workflow' ? '涉及逻辑' : '仅展示'}
                </span>
                <button
                  type="button"
                  className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--text-3)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ring)]"
                  aria-label={`查看${field.label}字段说明`}
                  aria-expanded={descriptionExpanded}
                  aria-controls={descriptionId}
                  title={`查看${field.label}字段说明`}
                  onClick={() => setExpandedField(descriptionExpanded ? null : field.key)}
                >
                  <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="9" strokeWidth="2" />
                    <path strokeLinecap="round" strokeWidth="2" d="M12 11v5m0-8h.01" />
                  </svg>
                </button>
              </div>
              {descriptionExpanded && (
                <p id={descriptionId} className="mb-2 rounded-lg bg-[var(--surface-inset)] px-2.5 py-1.5 text-[11px] leading-relaxed text-[var(--text-2)]">
                  {field.note}
                </p>
              )}
              {field.multiline ? (
                <textarea
                  value={value}
                  readOnly
                  rows={value.trim() ? 3 : 1}
                  aria-label={field.label}
                  aria-readonly="true"
                  aria-describedby={descriptionExpanded ? descriptionId : undefined}
                  className={`${READ_ONLY_FIELD_CLASS} resize-none`}
                  placeholder="AI 策划后显示"
                />
              ) : (
                <input
                  value={value}
                  readOnly
                  aria-label={field.label}
                  aria-readonly="true"
                  aria-describedby={descriptionExpanded ? descriptionId : undefined}
                  className={READ_ONLY_FIELD_CLASS}
                  placeholder="AI 策划后显示"
                />
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
