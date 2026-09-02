import type { CustomProviderDefinition } from '../types'

export interface CustomProviderForm {
  json: string
}

export const DEFAULT_CUSTOM_PROVIDER_MANIFEST = {
  name: '自定义服务商',
  submit: {
    path: 'images/generations',
    method: 'POST',
    contentType: 'json',
    body: {
      model: '$profile.model',
      prompt: '$prompt',
      size: '$params.size',
      quality: '$params.quality',
      output_format: '$params.output_format',
      moderation: '$params.moderation',
      output_compression: '$params.output_compression',
      n: '$params.n',
    },
    result: { imageUrlPaths: ['data.*.url'], b64JsonPaths: ['data.*.b64_json'] },
  },
  editSubmit: {
    path: 'images/edits',
    method: 'POST',
    contentType: 'multipart',
    body: {
      model: '$profile.model',
      prompt: '$prompt',
      size: '$params.size',
      quality: '$params.quality',
      output_format: '$params.output_format',
      moderation: '$params.moderation',
      output_compression: '$params.output_compression',
      n: '$params.n',
    },
    files: [
      { field: 'image[]', source: 'inputImages', array: true },
      { field: 'mask', source: 'mask' },
    ],
    result: { imageUrlPaths: ['data.*.url'], b64JsonPaths: ['data.*.b64_json'] },
  },
} as const

export function createDefaultCustomProviderForm(): CustomProviderForm {
  return { json: JSON.stringify(DEFAULT_CUSTOM_PROVIDER_MANIFEST, null, 2) }
}

export function customProviderToForm(provider: CustomProviderDefinition): CustomProviderForm {
  return {
    json: JSON.stringify(
      { name: provider.name, submit: provider.submit, editSubmit: provider.editSubmit, poll: provider.poll },
      null,
      2,
    ),
  }
}

export function customProviderFormToInput(form: CustomProviderForm): unknown {
  return JSON.parse(form.json)
}
