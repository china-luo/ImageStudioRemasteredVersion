import { describe, expect, it } from 'vitest'
import { resolvePlannerStyleReference } from './plannerActionPolicy'

describe('planner style reference policy', () => {
  it('requires a style reference for a non-main image', () => {
    expect(resolvePlannerStyleReference({
      requiredForSubmit: true,
      hasStyleReference: false,
      uploadedReferenceCount: 2,
      maxUploadedReferences: 16,
    })).toEqual({
      attach: false,
      issue: 'missing',
    })
  })

  it('does not count the required style reference toward the 16 uploaded-reference limit', () => {
    expect(resolvePlannerStyleReference({
      requiredForSubmit: true,
      hasStyleReference: true,
      uploadedReferenceCount: 16,
      maxUploadedReferences: 16,
    })).toEqual({
      attach: true,
      issue: null,
    })
  })

  it('reports only uploaded product references above the limit', () => {
    expect(resolvePlannerStyleReference({
      requiredForSubmit: true,
      hasStyleReference: true,
      uploadedReferenceCount: 17,
      maxUploadedReferences: 16,
    })).toEqual({
      attach: true,
      issue: 'uploaded-limit',
    })
  })

  it('does not require a style reference for the MAIN image', () => {
    expect(resolvePlannerStyleReference({
      requiredForSubmit: false,
      hasStyleReference: true,
      uploadedReferenceCount: 2,
      maxUploadedReferences: 16,
    })).toEqual({
      attach: false,
      issue: null,
    })
  })
})
