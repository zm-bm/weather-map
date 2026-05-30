import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_PARTICLE_RENDER_SETTINGS,
  DEFAULT_FORECAST_SETTINGS,
  particleSizeSettingsForRatio,
  particleTrailFadeFromLength,
  type ForecastSettings,
  type ForecastSettingsActions,
} from '@/forecast/settings'
import MapOptionsButton from './MapOptionsButton'

const PARTICLE_SIZE_RATIO = 1.25
const PARTICLE_SIZE = particleSizeSettingsForRatio(PARTICLE_SIZE_RATIO)
const TRAIL_LENGTH = 5
const TRAIL_FADE = particleTrailFadeFromLength(TRAIL_LENGTH)

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
    const opacitySlider = screen.getByRole('slider', { name: 'Layer opacity', hidden: true }) as HTMLInputElement
    const densitySlider = screen.getByRole('slider', { name: 'Particle density', hidden: true }) as HTMLInputElement
    const speedSlider = screen.getByRole('slider', { name: 'Particle speed', hidden: true }) as HTMLInputElement
    const sizeSlider = screen.getByRole('slider', { name: 'Particle size', hidden: true }) as HTMLInputElement
    const trailOpacitySlider = screen.getByRole('slider', { name: 'Particle trail opacity', hidden: true }) as HTMLInputElement
    const trailLengthSlider = screen.getByRole('slider', { name: 'Particle trail length', hidden: true }) as HTMLInputElement

    expect(panel).toBeTruthy()
    expect(panel?.hidden).toBe(true)
    expect(bandedRadio).not.toBeChecked()
    expect(opacitySlider.value).toBe(String(DEFAULT_FORECAST_SETTINGS.raster.opacity))
    expect(densitySlider.value).toBe(String(DEFAULT_FORECAST_SETTINGS.particles.particleCount))
    expect(speedSlider.value).toBe('1')
    expect(sizeSlider.value).toBe('1')
    expect(trailOpacitySlider.value).toBe(String(DEFAULT_FORECAST_SETTINGS.particles.trailCompositeOpacity))
    expect(trailLengthSlider.value).toBe('8')
    expect(showParticlesCheckbox).toBeChecked()
    expect(pressureContoursCheckbox).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: 'Clear trails on view change', hidden: true }))
      .not.toBeInTheDocument()

    fireEvent.click(button)
    expect(panel?.hidden).toBe(false)

    fireEvent.change(opacitySlider, { target: { value: '0.65' } })
    expect(actions.updateRaster).toHaveBeenCalledWith({ opacity: 0.65 })

    fireEvent.change(densitySlider, { target: { value: '12000' } })
    expect(actions.updateParticles).toHaveBeenCalledWith({ particleCount: 12000 })

    fireEvent.change(speedSlider, { target: { value: '1.2' } })
    expect(actions.updateParticles).toHaveBeenCalledWith({
      flowSpeedScale: Math.round(DEFAULT_PARTICLE_RENDER_SETTINGS.flowSpeedScale * 1.2),
    })

    fireEvent.change(sizeSlider, { target: { value: String(PARTICLE_SIZE_RATIO) } })
    expect(actions.updateParticles).toHaveBeenCalledWith(PARTICLE_SIZE)

    fireEvent.change(trailOpacitySlider, { target: { value: '0.45' } })
    expect(actions.updateParticles).toHaveBeenCalledWith({
      trailCompositeOpacity: 0.45,
    })

    fireEvent.change(trailLengthSlider, { target: { value: String(TRAIL_LENGTH) } })
    expect(actions.updateParticles).toHaveBeenCalledWith({
      trailFade: TRAIL_FADE,
    })

    fireEvent.click(bandedRadio)
    expect(actions.updateRaster).toHaveBeenCalledWith({ colorSamplingMode: 'banded' })
    rerender(
      <MapOptionsButton
        settings={{
          ...SETTINGS,
          raster: {
            colorSamplingMode: 'banded',
            opacity: 0.65,
          },
          particles: {
            ...SETTINGS.particles,
            particleCount: 12000,
            flowSpeedScale: Math.round(DEFAULT_PARTICLE_RENDER_SETTINGS.flowSpeedScale * 1.2),
            ...PARTICLE_SIZE,
            trailCompositeOpacity: 0.45,
            trailFade: TRAIL_FADE,
          },
        }}
        settingsActions={actions}
      />
    )
    expect(bandedRadio).toBeChecked()
    expect(opacitySlider.value).toBe('0.65')
    expect(densitySlider.value).toBe('12000')
    expect(speedSlider.value).toBe('1.2')
    expect(sizeSlider.value).toBe(String(PARTICLE_SIZE_RATIO))
    expect(trailOpacitySlider.value).toBe('0.45')
    expect(trailLengthSlider.value).toBe(String(TRAIL_LENGTH))

    fireEvent.click(showParticlesCheckbox)
    expect(actions.updateParticles).toHaveBeenCalledWith({ enabled: false })
    rerender(
      <MapOptionsButton
        settings={{
          ...SETTINGS,
          raster: {
            colorSamplingMode: 'banded',
            opacity: 0.65,
          },
          particles: {
            ...SETTINGS.particles,
            enabled: false,
            particleCount: 12000,
            flowSpeedScale: Math.round(DEFAULT_PARTICLE_RENDER_SETTINGS.flowSpeedScale * 1.2),
            ...PARTICLE_SIZE,
            trailCompositeOpacity: 0.45,
            trailFade: TRAIL_FADE,
          },
        }}
        settingsActions={actions}
      />
    )
    expect(showParticlesCheckbox).not.toBeChecked()
    expect(densitySlider).toBeDisabled()
    expect(speedSlider).toBeDisabled()
    expect(sizeSlider).toBeDisabled()
    expect(trailOpacitySlider).toBeDisabled()
    expect(trailLengthSlider).toBeDisabled()

    fireEvent.click(pressureContoursCheckbox)
    expect(actions.updatePressureContours).toHaveBeenCalledWith({ enabled: false })
    rerender(
      <MapOptionsButton
        settings={{
          ...SETTINGS,
          raster: {
            colorSamplingMode: 'banded',
            opacity: 0.65,
          },
          particles: {
            ...SETTINGS.particles,
            enabled: false,
            particleCount: 12000,
            flowSpeedScale: Math.round(DEFAULT_PARTICLE_RENDER_SETTINGS.flowSpeedScale * 1.2),
            ...PARTICLE_SIZE,
            trailCompositeOpacity: 0.45,
            trailFade: TRAIL_FADE,
          },
          pressureContours: {
            enabled: false,
          },
        }}
        settingsActions={actions}
      />
    )
    expect(pressureContoursCheckbox).not.toBeChecked()
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
