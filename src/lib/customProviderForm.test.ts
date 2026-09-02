import { describe, expect, it } from 'vitest'
import { createDefaultCustomProviderForm, customProviderFormToInput, customProviderToForm } from './customProviderForm'

describe('custom provider form', () => {
  it('creates a parseable default manifest', () => {
    const manifest = customProviderFormToInput(createDefaultCustomProviderForm()) as { submit: { path: string } }
    expect(manifest.submit.path).toBe('images/generations')
  })

  it('preserves a provider definition in form JSON', () => {
    const form = customProviderToForm({ id: 'custom-x', name: 'X', submit: { path: 'images/generations' } } as never)
    expect(customProviderFormToInput(form)).toMatchObject({ name: 'X', submit: { path: 'images/generations' } })
  })
})
