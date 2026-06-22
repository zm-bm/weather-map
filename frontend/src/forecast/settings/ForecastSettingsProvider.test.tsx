import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'

import {
  DEFAULT_FORECAST_SETTINGS,
  ForecastSettingsProvider,
  particleSizeSettingsForRatio,
  particleTrailFadeFromLength,
  useForecastSettings,
} from './index'
import { FORECAST_SETTINGS_STORAGE_KEY } from './settingsPersistence'

const PARTICLE_SIZE = particleSizeSettingsForRatio(1.25)
const TRAIL_FADE = particleTrailFadeFromLength(5)

function wrapper({ children }: { children: ReactNode }) {
  return (
    <ForecastSettingsProvider>
      {children}
    </ForecastSettingsProvider>
  )
}

describe('ForecastSettingsProvider', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('exposes default settings', () => {
    const { result } = renderHook(() => useForecastSettings(), { wrapper })

    expect(result.current.settings).toEqual(DEFAULT_FORECAST_SETTINGS)
  })

  it('updates each setting group independently', () => {
    const { result } = renderHook(() => useForecastSettings(), { wrapper })

    act(() => {
      result.current.actions.updateRaster({
        gridSamplingMode: 'nearest',
        colorSamplingMode: 'banded',
        opacity: 0.7,
      })
      result.current.actions.updateParticles({
        enabled: false,
        particleCount: 12000,
        flowSpeedScale: 8000,
        ...PARTICLE_SIZE,
        trailCompositeOpacity: 0.45,
        trailFade: TRAIL_FADE,
      })
      result.current.actions.updatePressureContours({ enabled: true })
      result.current.actions.toggleUnitSystem()
    })

    expect(result.current.settings).toEqual(expect.objectContaining({
      raster: expect.objectContaining({
        gridSamplingMode: 'nearest',
        colorSamplingMode: 'banded',
        opacity: 0.7,
      }),
      particles: expect.objectContaining({
        enabled: false,
        particleCount: 12000,
        flowSpeedScale: 8000,
        ...PARTICLE_SIZE,
        trailCompositeOpacity: 0.45,
        trailFade: TRAIL_FADE,
      }),
      pressureContours: { enabled: true },
      units: { system: 'metric' },
    }))
  })

  it('toggles the unit system', () => {
    const { result } = renderHook(() => useForecastSettings(), { wrapper })

    expect(result.current.settings.units.system).toBe('imperial')

    act(() => {
      result.current.actions.toggleUnitSystem()
    })
    expect(result.current.settings.units.system).toBe('metric')

    act(() => {
      result.current.actions.toggleUnitSystem()
    })
    expect(result.current.settings.units.system).toBe('imperial')
  })

  it('loads valid stored UI preferences', () => {
    storeRawSettings({
      raster: { gridSamplingMode: 'nearest', colorSamplingMode: 'banded', opacity: 0.65 },
      particles: {
        enabled: false,
        particleCount: 11000,
        flowSpeedScale: 7200,
        ...PARTICLE_SIZE,
        trailCompositeOpacity: 0.45,
        trailFade: TRAIL_FADE,
      },
      pressureContours: { enabled: true },
      units: { system: 'metric' },
    })

    const { result } = renderHook(() => useForecastSettings(), { wrapper })

    expect(result.current.settings).toEqual(expect.objectContaining({
      raster: { gridSamplingMode: 'nearest', colorSamplingMode: 'banded', opacity: 0.65 },
      particles: expect.objectContaining({
        enabled: false,
        particleCount: 11000,
        flowSpeedScale: 7200,
        ...PARTICLE_SIZE,
        trailCompositeOpacity: 0.45,
        trailFade: TRAIL_FADE,
      }),
      pressureContours: { enabled: true },
      units: { system: 'metric' },
    }))
  })

  it('falls back to defaults for invalid stored settings', () => {
    storeRawSettings({
      raster: { gridSamplingMode: 'invalid', colorSamplingMode: 'invalid', opacity: 2 },
      particles: {
        enabled: 'false',
        particleCount: 1,
        flowSpeedScale: 12000,
        dotMinPx: 100,
        dotMaxPx: -1,
        trailCompositeOpacity: 2,
        trailFade: 0.5,
      },
      pressureContours: { enabled: 'true' },
      units: { system: 'kelvin' },
    })

    const { result } = renderHook(() => useForecastSettings(), { wrapper })

    expect(result.current.settings).toEqual(DEFAULT_FORECAST_SETTINGS)
  })

  it('saves changed UI preferences', async () => {
    const { result } = renderHook(() => useForecastSettings(), { wrapper })

    act(() => {
      result.current.actions.updateRaster({
        gridSamplingMode: 'nearest',
        colorSamplingMode: 'banded',
        opacity: 0.75,
      })
      result.current.actions.updateParticles({
        enabled: false,
        particleCount: 15000,
        flowSpeedScale: 8800,
        ...PARTICLE_SIZE,
        trailCompositeOpacity: 0.45,
        trailFade: TRAIL_FADE,
      })
      result.current.actions.updatePressureContours({ enabled: true })
      result.current.actions.toggleUnitSystem()
    })

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(FORECAST_SETTINGS_STORAGE_KEY) ?? '')).toEqual({
        raster: {
          gridSamplingMode: 'nearest',
          colorSamplingMode: 'banded',
          opacity: 0.75,
        },
        particles: {
          enabled: false,
          particleCount: 15000,
          flowSpeedScale: 8800,
          ...PARTICLE_SIZE,
          trailCompositeOpacity: 0.45,
          trailFade: TRAIL_FADE,
        },
        pressureContours: {
          enabled: true,
        },
        units: {
          system: 'metric',
        },
      })
    })
  })
})

function storeRawSettings(value: unknown): void {
  localStorage.setItem(FORECAST_SETTINGS_STORAGE_KEY, JSON.stringify(value))
}
