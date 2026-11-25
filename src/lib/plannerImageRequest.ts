import type { InputImage } from '../types'
import type { AmazonMarketplaceId } from './amazonMarketplaces'
import {
  buildAmazonAPlusPlanPrompt,
  buildAmazonPlanPrompt,
  buildTiktokPlanPrompt,
  isAmazonListingMainSlot,
  type AmazonPlannerMode,
  type AmazonStyleDensityMode,
  type CommercePlannerPlatform,
} from './listingPlanner'

export interface PlannerSource {
  listingText: string
  referenceImageIds: string[]
}

export function getPlannerSourceIssue(planned: PlannerSource | null, listingText: string, ids: string[]) {
  if (!planned) return ''
  if (
    planned.listingText.trim() === listingText.trim() &&
    planned.referenceImageIds.every((id, i) => ids[i] === id) &&
    planned.referenceImageIds.length === ids.length
  )
    return ''
  const missing = planned.referenceImageIds.filter((id) => !ids.includes(id)).length
  return missing
    ? `策划所用的 ${missing} 张参考图不在当前列表中。请恢复原参考图及其顺序，或按当前资料重新策划。`
    : '商品资料或参考图顺序已变化。请按当前资料重新策划，或还原策划时的资料及参考图。'
}

// The gallery preserves existing order and appends only a separate style reference.
// Use the same rule for the prompt and attachment preview rather than renumbering product references.
export function getPlannerReferenceOrder(ids: string[], styleImageId?: string | null) {
  const existingIndex = styleImageId ? ids.indexOf(styleImageId) : -1
  const appendStyle = Boolean(styleImageId && existingIndex === -1)
  return {
    ids: appendStyle && styleImageId ? [...ids, styleImageId] : ids,
    styleIndex: !styleImageId ? -1 : appendStyle ? ids.length : existingIndex,
    appendStyle,
  }
}

export function plannerUsesStyleReference(platform: CommercePlannerPlatform, mode: AmazonPlannerMode, slot?: string) {
  return platform === 'tiktok' || mode === 'aplus' || !isAmazonListingMainSlot(slot)
}

// Old workspaces saved the complete generated prompt. Keep the authored sections,
// but discard the legacy automatically generated blocks before reapplying live rules.
export function getPlannerCreativeOverride(text?: string) {
  return (text ?? '')
    .trim()
    .split(/\n\s*\n/)
    .filter(
      (block) =>
        !/^(Series style guide:|Target marketplace:|Layout density:|Style reference rule:|TikTok Shop US main image generation rules:|Mandatory (?:Amazon MAIN|TikTok Shop US) image[^\n]*rules)/.test(
          block,
        ),
    )
    .join('\n\n')
    .trim()
}

export function buildPlannerImageRequest(options: {
  platform: CommercePlannerPlatform
  mode: AmazonPlannerMode
  plan: { slot: string; prompt: string; negativePrompt: string }
  override?: string
  marketplaceId: AmazonMarketplaceId
  styleDensityMode: AmazonStyleDensityMode
  seriesStyleGuide: string
  styleImageId?: string | null
  inputImages: readonly Pick<InputImage, 'id'>[]
}) {
  const { plan, platform, mode } = options
  const needsStyle = plannerUsesStyleReference(platform, mode, plan.slot)
  const styleImageId = needsStyle ? options.styleImageId : null
  const references = getPlannerReferenceOrder(
    options.inputImages.map(({ id }) => id),
    styleImageId,
  )
  const creative = getPlannerCreativeOverride(options.override)
  // An old or new manual negative section replaces the planner's negative section.
  // If the edit contains no negative section, retain the planned negative constraints.
  const negativeMarker = creative.search(/(?:^|\n\s*\n)Negative prompt:\s*/i)
  const creativePrompt = negativeMarker < 0 ? creative : creative.slice(0, negativeMarker).trim()
  const editedNegative =
    negativeMarker < 0
      ? undefined
      : creative
          .slice(negativeMarker)
          .replace(/^\s*Negative prompt:\s*/i, '')
          .trim()
  const builder =
    mode === 'aplus'
      ? buildAmazonAPlusPlanPrompt
      : platform === 'tiktok'
        ? buildTiktokPlanPrompt
        : buildAmazonPlanPrompt
  const prompt = builder({
    ...plan,
    prompt: creativePrompt || plan.prompt,
    negativePrompt: editedNegative ?? plan.negativePrompt,
    seriesStyleGuide: platform === 'tiktok' && plan.slot === 'TTM01' ? null : options.seriesStyleGuide,
    marketplaceId: options.marketplaceId,
    styleDensityMode: options.styleDensityMode,
    styleReferenceAttached: Boolean(styleImageId),
    styleReferencePosition: references.styleIndex === references.ids.length - 1 ? null : references.styleIndex + 1,
  })
  return { prompt, needsStyle, styleImageId, ...references }
}
