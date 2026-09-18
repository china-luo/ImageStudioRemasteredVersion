import { describe, expect, it } from 'vitest'
import {
  finishWorkspaceAnalysis,
  getWorkspaceAnalysis,
  isWorkspaceAnalysisCurrent,
  startWorkspaceAnalysis,
  stopWorkspaceAnalysis,
} from './workspaceAnalysis'

describe('workspace analysis lifecycle', () => {
  it('keeps the active request addressable across component remounts', () => {
    const analysis = startWorkspaceAnalysis('sop')
    expect(getWorkspaceAnalysis('sop')?.requestId).toBe(analysis.requestId)
    expect(isWorkspaceAnalysisCurrent('sop', analysis.requestId)).toBe(true)
    expect(stopWorkspaceAnalysis('sop')).toBe(analysis.requestId)
    expect(getWorkspaceAnalysis('sop')).toBeNull()
  })

  it('ignores a stale request after a newer request starts', () => {
    const first = startWorkspaceAnalysis('voc')
    const second = startWorkspaceAnalysis('voc')
    expect(first.controller.signal.aborted).toBe(true)
    expect(isWorkspaceAnalysisCurrent('voc', first.requestId)).toBe(false)
    expect(isWorkspaceAnalysisCurrent('voc', second.requestId)).toBe(true)
    finishWorkspaceAnalysis('voc', first.requestId)
    expect(getWorkspaceAnalysis('voc')?.requestId).toBe(second.requestId)
    stopWorkspaceAnalysis('voc')
  })
})
