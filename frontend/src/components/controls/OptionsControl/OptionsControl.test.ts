import { describe, expect, it } from 'vitest'

import { OptionsControl } from './OptionsControl'
import { DEFAULT_VECTOR_RUNTIME_OPTIONS } from '../../../forecast-layers/vector'

describe('OptionsControl', () => {
  it('toggles panel visibility and updates scalar/vector runtime options', async () => {
    const scalarOptions = { colorSamplingMode: 'interpolated' as const }
    const vectorOptions = { ...DEFAULT_VECTOR_RUNTIME_OPTIONS }
    const control = new OptionsControl({ scalarOptions, vectorOptions })
    const root = control.onAdd()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const button = root.querySelector('button')
    const panel = root.querySelector('.maplibregl-ctrl-options-panel') as HTMLDivElement | null
    const checkbox = root.querySelector('input[type="checkbox"]') as HTMLInputElement | null
    const scalarBandedRadio = root.querySelector(
      'input[type="radio"][name="scalar-color-sampling-mode"][value="banded"]'
    ) as HTMLInputElement | null

    expect(button).toBeTruthy()
    expect(panel).toBeTruthy()
    expect(checkbox).toBeTruthy()
    expect(scalarBandedRadio).toBeTruthy()
    expect(panel?.hidden).toBe(true)
    expect(scalarOptions.colorSamplingMode).toBe('interpolated')
    expect(vectorOptions.clearTrailsOnViewChange).toBe(true)

    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(panel?.hidden).toBe(false)

    scalarBandedRadio?.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(scalarOptions.colorSamplingMode).toBe('banded')

    checkbox?.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(vectorOptions.clearTrailsOnViewChange).toBe(false)

    control.onRemove()
  })
})
