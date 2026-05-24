import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_FORECAST_SETTINGS,
  type ForecastSettings,
  type ForecastSettingsActions,
} from '@/forecast/settings'
import MapOptionsButton from './MapOptionsButton'

const SETTINGS: ForecastSettings = {
  ...DEFAULT_FORECAST_SETTINGS,
  field: {
    ...DEFAULT_FORECAST_SETTINGS.field,
    colorSamplingMode: 'interpolated',
  },
  pressureContours: {
    enabled: true,
  },
}

function createActions(): ForecastSettingsActions {
  return {
    updateField: vi.fn(),
    updateParticles: vi.fn(),
    updatePressureContours: vi.fn(),
    updateUnits: vi.fn(),
    toggleUnitSystem: vi.fn(),
  }
}

describe('MapOptionsButton', () => {
  it('toggles panel visibility and requests map setting changes', async () => {
    const actions = createActions()
    const { container, rerender } = render(
      <MapOptionsButton
        settings={SETTINGS}
        settingsActions={actions}
      />
    )

    const button = container.querySelector('button')
    const panel = container.querySelector('.map-control-options-panel') as HTMLDivElement | null
    const showParticlesCheckbox = screen.getByRole('checkbox', { name: 'Show particles', hidden: true })
    const pressureContoursCheckbox = screen.getByRole('checkbox', { name: 'Show pressure contours', hidden: true })
    const clearTrailsCheckbox = screen.getByRole('checkbox', { name: 'Clear trails on view change', hidden: true })
    const bandedRadio = container.querySelector(
      'input[type="radio"][name="layer-color-sampling-mode"][value="banded"]'
    ) as HTMLInputElement | null

    expect(button).toBeTruthy()
    expect(panel).toBeTruthy()
    expect(bandedRadio).toBeTruthy()
    expect(panel?.hidden).toBe(true)
    expect(bandedRadio?.checked).toBe(false)
    expect(showParticlesCheckbox).toBeChecked()
    expect(pressureContoursCheckbox).toBeChecked()
    expect(clearTrailsCheckbox).toBeChecked()

    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(panel?.hidden).toBe(false)

    showParticlesCheckbox.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(actions.updateParticles).toHaveBeenCalledWith({ enabled: false })
    rerender(
      <MapOptionsButton
        settings={{
          ...SETTINGS,
          particles: {
            ...SETTINGS.particles,
            enabled: false,
          },
        }}
        settingsActions={actions}
      />
    )
    expect(showParticlesCheckbox).not.toBeChecked()

    pressureContoursCheckbox.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(actions.updatePressureContours).toHaveBeenCalledWith({ enabled: false })
    rerender(
      <MapOptionsButton
        settings={{
          ...SETTINGS,
          particles: {
            ...SETTINGS.particles,
            enabled: false,
          },
          pressureContours: {
            enabled: false,
          },
        }}
        settingsActions={actions}
      />
    )
    expect(pressureContoursCheckbox).not.toBeChecked()

    bandedRadio?.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(actions.updateField).toHaveBeenCalledWith({ colorSamplingMode: 'banded' })
    rerender(
      <MapOptionsButton
        settings={{
          ...SETTINGS,
          field: {
            colorSamplingMode: 'banded',
          },
          particles: {
            ...SETTINGS.particles,
            enabled: false,
          },
          pressureContours: {
            enabled: false,
          },
        }}
        settingsActions={actions}
      />
    )
    expect(bandedRadio?.checked).toBe(true)

    clearTrailsCheckbox.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(actions.updateParticles).toHaveBeenCalledWith({ clearTrailsOnViewChange: false })
    rerender(
      <MapOptionsButton
        settings={{
          ...SETTINGS,
          field: {
            colorSamplingMode: 'banded',
          },
          particles: {
            ...SETTINGS.particles,
            enabled: false,
            clearTrailsOnViewChange: false,
          },
          pressureContours: {
            enabled: false,
          },
        }}
        settingsActions={actions}
      />
    )
    expect(clearTrailsCheckbox).not.toBeChecked()
  })

  it('closes the panel when clicking outside without closing on inside clicks', async () => {
    const { container } = render(
      <MapOptionsButton
        settings={SETTINGS}
        settingsActions={createActions()}
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
