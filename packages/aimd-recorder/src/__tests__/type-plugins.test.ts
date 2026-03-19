import { describe, expect, it } from 'vitest'

import { BUILT_IN_AIMD_TYPE_PLUGINS, createAimdTypePlugins, resolveAimdTypePlugin } from '../type-plugins'
import { getVarInputDisplayValue, getVarInputKind, parseVarInputValue } from '../composables/useVarHelpers'
import type { AimdTypePlugin } from '../types'

describe('type-plugins', () => {
  it('includes built-in recorder plugins for official interactive types', () => {
    const plugin = resolveAimdTypePlugin('DNASequence', BUILT_IN_AIMD_TYPE_PLUGINS)
    expect(plugin?.type).toBe('DNASequence')
    expect(plugin?.inputKind).toBe('dna')
  })

  it('lets host plugins override built-in type behavior', () => {
    const customPlugin: AimdTypePlugin = {
      type: 'DNASequence',
      inputKind: 'textarea',
    }

    const resolved = resolveAimdTypePlugin('DNASequence', createAimdTypePlugins([customPlugin]))
    expect(resolved).toBe(customPlugin)
    expect(getVarInputKind('DNASequence', { typePlugin: resolved })).toBe('textarea')
  })

  it('uses custom plugin parse and display hooks when provided', () => {
    const customPlugin: AimdTypePlugin = {
      type: 'MicroscopeCapture',
      inputKind: 'text',
      parseInputValue: ({ rawValue }) => ({ raw: rawValue, parsed: true }),
      getDisplayValue: ({ value }) => JSON.stringify(value),
    }

    expect(
      parseVarInputValue('capture-001', 'MicroscopeCapture', 'text', { typePlugin: customPlugin }),
    ).toEqual({ raw: 'capture-001', parsed: true })

    expect(
      getVarInputDisplayValue({ capture: 1 }, 'text', { type: 'MicroscopeCapture', typePlugin: customPlugin }),
    ).toBe(JSON.stringify({ capture: 1 }))
  })
})
