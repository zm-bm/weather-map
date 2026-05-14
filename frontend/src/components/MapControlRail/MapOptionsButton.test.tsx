import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_PARTICLE_RUNTIME_OPTIONS,
  type FieldRuntimeOptions,
} from '../../forecast-render/options'
import MapOptionsButton from './MapOptionsButton'

describe('MapOptionsButton', () => {
  it('toggles panel visibility and updates layer color and particle runtime options', async () => {
    const layerColorOptions: FieldRuntimeOptions = { colorSamplingMode: 'interpolated' }
    const particleOptions = { ...DEFAULT_PARTICLE_RUNTIME_OPTIONS }
    const onLayerColorSamplingModeChange = vi.fn()
    const onClearTrailsOnViewChange = vi.fn()
    const { container } = render(
      <MapOptionsButton
        layerColorOptions={layerColorOptions}
        particleOptions={particleOptions}
        onLayerColorSamplingModeChange={onLayerColorSamplingModeChange}
        onClearTrailsOnViewChange={onClearTrailsOnViewChange}
      />
    )

    const button = container.querySelector('button')
    const panel = container.querySelector('.map-control-options-panel') as HTMLDivElement | null
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null
    const bandedRadio = container.querySelector(
      'input[type="radio"][name="layer-color-sampling-mode"][value="banded"]'
    ) as HTMLInputElement | null

    expect(button).toBeTruthy()
    expect(panel).toBeTruthy()
    expect(checkbox).toBeTruthy()
    expect(bandedRadio).toBeTruthy()
    expect(panel?.hidden).toBe(true)
    expect(layerColorOptions.colorSamplingMode).toBe('interpolated')
    expect(particleOptions.clearTrailsOnViewChange).toBe(true)
    expect(bandedRadio?.checked).toBe(false)
    expect(checkbox?.checked).toBe(true)

    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(panel?.hidden).toBe(false)

    bandedRadio?.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onLayerColorSamplingModeChange).toHaveBeenCalledWith('banded')
    expect(bandedRadio?.checked).toBe(true)

    checkbox?.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onClearTrailsOnViewChange).toHaveBeenCalledWith(false)
    expect(checkbox?.checked).toBe(false)
  })

  it('closes the panel when clicking outside without closing on inside clicks', async () => {
    const layerColorOptions: FieldRuntimeOptions = { colorSamplingMode: 'interpolated' }
    const particleOptions = { ...DEFAULT_PARTICLE_RUNTIME_OPTIONS }
    const { container } = render(
      <MapOptionsButton
        layerColorOptions={layerColorOptions}
        particleOptions={particleOptions}
        onLayerColorSamplingModeChange={vi.fn()}
        onClearTrailsOnViewChange={vi.fn()}
      />
    )

    const button = container.querySelector('button')
    const panel = container.querySelector('.map-control-options-panel') as HTMLDivElement | null
    const bandedRadio = container.querySelector(
      'input[type="radio"][name="layer-color-sampling-mode"][value="banded"]'
    ) as HTMLInputElement | null

    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(panel?.hidden).toBe(false)

    if (bandedRadio) {
      fireEvent.pointerDown(bandedRadio)
    }
    expect(panel?.hidden).toBe(false)

    fireEvent.pointerDown(document.body)
    expect(panel?.hidden).toBe(true)
  })
})
