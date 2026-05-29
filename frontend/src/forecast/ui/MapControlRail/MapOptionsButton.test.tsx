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
  raster: {
    ...DEFAULT_FORECAST_SETTINGS.raster,
    colorSamplingMode: 'interpolated',
  },
  pressureContours: {
    enabled: true,
  },
}

function createActions(): ForecastSettingsActions {
  return {
    updateRaster: vi.fn(),
    updateParticles: vi.fn(),
    updatePressureContours: vi.fn(),
    updateUnits: vi.fn(),
    toggleUnitSystem: vi.fn(),
  }
}

describe('MapOptionsButton', () => {
  it('toggles panel visibility and requests map setting changes', () => {
    const actions = createActions()
    const { rerender } = render(
      <MapOptionsButton
        settings={SETTINGS}
        settingsActions={actions}
      />
    )

    const button = screen.getByRole('button', { name: 'Map options' })
    const panel = screen.getByText('Layer Color').closest('.map-control-options-panel') as HTMLDivElement | null
    const showParticlesCheckbox = screen.getByRole('checkbox', { name: 'Show particles', hidden: true })
    const pressureContoursCheckbox = screen.getByRole('checkbox', { name: 'Show pressure contours', hidden: true })
    const bandedRadio = screen.getByRole('radio', { name: 'Banded', hidden: true })

    expect(panel).toBeTruthy()
    expect(panel?.hidden).toBe(true)
    expect(bandedRadio).not.toBeChecked()
    expect(showParticlesCheckbox).toBeChecked()
    expect(pressureContoursCheckbox).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: 'Clear trails on view change', hidden: true }))
      .not.toBeInTheDocument()

    fireEvent.click(button)
    expect(panel?.hidden).toBe(false)

    fireEvent.click(showParticlesCheckbox)
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

    fireEvent.click(pressureContoursCheckbox)
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

    fireEvent.click(bandedRadio)
    expect(actions.updateRaster).toHaveBeenCalledWith({ colorSamplingMode: 'banded' })
    rerender(
      <MapOptionsButton
        settings={{
          ...SETTINGS,
          raster: {
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
    expect(bandedRadio).toBeChecked()
  })

  it('closes the panel when clicking outside without closing on inside clicks', () => {
    render(
      <MapOptionsButton
        settings={SETTINGS}
        settingsActions={createActions()}
      />
    )

    const button = screen.getByRole('button', { name: 'Map options' })
    const panel = screen.getByText('Layer Color').closest('.map-control-options-panel') as HTMLDivElement | null
    const bandedRadio = screen.getByRole('radio', { name: 'Banded', hidden: true })

    fireEvent.click(button)
    expect(panel?.hidden).toBe(false)

    fireEvent.pointerDown(bandedRadio)
    expect(panel?.hidden).toBe(false)

    fireEvent.pointerDown(document.body)
    expect(panel?.hidden).toBe(true)
  })
})
