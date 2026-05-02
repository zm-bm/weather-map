import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_VECTOR_RUNTIME_OPTIONS,
  type ScalarRuntimeOptions,
} from '../../forecast-layers/options'
import MapOptionsButton from './MapOptionsButton'

describe('MapOptionsButton', () => {
  it('toggles panel visibility and updates scalar/vector runtime options', async () => {
    const scalarOptions: ScalarRuntimeOptions = { colorSamplingMode: 'interpolated' }
    const vectorOptions = { ...DEFAULT_VECTOR_RUNTIME_OPTIONS }
    const onScalarColorSamplingModeChange = vi.fn()
    const onClearTrailsOnViewChange = vi.fn()
    const { container } = render(
      <MapOptionsButton
        scalarOptions={scalarOptions}
        vectorOptions={vectorOptions}
        onScalarColorSamplingModeChange={onScalarColorSamplingModeChange}
        onClearTrailsOnViewChange={onClearTrailsOnViewChange}
      />
    )

    const button = container.querySelector('button')
    const panel = container.querySelector('.map-control-options-panel') as HTMLDivElement | null
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null
    const scalarBandedRadio = container.querySelector(
      'input[type="radio"][name="scalar-color-sampling-mode"][value="banded"]'
    ) as HTMLInputElement | null

    expect(button).toBeTruthy()
    expect(panel).toBeTruthy()
    expect(checkbox).toBeTruthy()
    expect(scalarBandedRadio).toBeTruthy()
    expect(panel?.hidden).toBe(true)
    expect(scalarOptions.colorSamplingMode).toBe('interpolated')
    expect(vectorOptions.clearTrailsOnViewChange).toBe(true)
    expect(scalarBandedRadio?.checked).toBe(false)
    expect(checkbox?.checked).toBe(true)

    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(panel?.hidden).toBe(false)

    scalarBandedRadio?.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onScalarColorSamplingModeChange).toHaveBeenCalledWith('banded')
    expect(scalarBandedRadio?.checked).toBe(true)

    checkbox?.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(onClearTrailsOnViewChange).toHaveBeenCalledWith(false)
    expect(checkbox?.checked).toBe(false)
  })

  it('closes the panel when clicking outside without closing on inside clicks', async () => {
    const scalarOptions: ScalarRuntimeOptions = { colorSamplingMode: 'interpolated' }
    const vectorOptions = { ...DEFAULT_VECTOR_RUNTIME_OPTIONS }
    const { container } = render(
      <MapOptionsButton
        scalarOptions={scalarOptions}
        vectorOptions={vectorOptions}
        onScalarColorSamplingModeChange={vi.fn()}
        onClearTrailsOnViewChange={vi.fn()}
      />
    )

    const button = container.querySelector('button')
    const panel = container.querySelector('.map-control-options-panel') as HTMLDivElement | null
    const scalarBandedRadio = container.querySelector(
      'input[type="radio"][name="scalar-color-sampling-mode"][value="banded"]'
    ) as HTMLInputElement | null

    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(panel?.hidden).toBe(false)

    if (scalarBandedRadio) {
      fireEvent.pointerDown(scalarBandedRadio)
    }
    expect(panel?.hidden).toBe(false)

    fireEvent.pointerDown(document.body)
    expect(panel?.hidden).toBe(true)
  })
})
