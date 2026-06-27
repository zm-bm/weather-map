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
      result.current.actions.updateMap({
        projection: 'mercator',
        placeValueLabelsEnabled: false,
      })
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
      map: { projection: 'mercator', placeValueLabelsEnabled: false },
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

  it('loads stored UI preferences from localStorage', () => {
    storeRawSettings({
      map: { projection: 'mercator', placeValueLabelsEnabled: false },
    })

    const { result } = renderHook(() => useForecastSettings(), { wrapper })

    expect(result.current.settings.map).toEqual({
      projection: 'mercator',
      placeValueLabelsEnabled: false,
    })
  })

  it('saves changed UI preferences', async () => {
    const { result } = renderHook(() => useForecastSettings(), { wrapper })

    act(() => {
      result.current.actions.updateMap({
        projection: 'mercator',
        placeValueLabelsEnabled: false,
      })
    })

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(FORECAST_SETTINGS_STORAGE_KEY) ?? '')).toEqual(expect.objectContaining({
        map: {
          projection: 'mercator',
          placeValueLabelsEnabled: false,
        },
      }))
    })
  })
})

function storeRawSettings(value: unknown): void {
  localStorage.setItem(FORECAST_SETTINGS_STORAGE_KEY, JSON.stringify(value))
}
