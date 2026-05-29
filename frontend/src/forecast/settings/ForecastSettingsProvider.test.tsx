import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'

import {
  DEFAULT_FORECAST_SETTINGS,
  ForecastSettingsProvider,
  useForecastSettings,
} from './index'
import { FORECAST_SETTINGS_STORAGE_KEY } from './settingsPersistence'

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
      result.current.actions.updateRaster({ colorSamplingMode: 'banded' })
      result.current.actions.updateParticles({ enabled: false })
      result.current.actions.updatePressureContours({ enabled: true })
      result.current.actions.updateUnits({ system: 'metric' })
    })

    expect(result.current.settings).toEqual(expect.objectContaining({
      raster: expect.objectContaining({ colorSamplingMode: 'banded' }),
      particles: expect.objectContaining({ enabled: false }),
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
      raster: { colorSamplingMode: 'banded' },
      particles: { enabled: false },
      pressureContours: { enabled: true },
      units: { system: 'metric' },
    })

    const { result } = renderHook(() => useForecastSettings(), { wrapper })

    expect(result.current.settings).toEqual(expect.objectContaining({
      raster: { colorSamplingMode: 'banded' },
      particles: expect.objectContaining({ enabled: false }),
      pressureContours: { enabled: true },
      units: { system: 'metric' },
    }))
  })

  it('falls back to defaults for invalid stored settings', () => {
    storeRawSettings({
      raster: { colorSamplingMode: 'invalid' },
      particles: { enabled: 'false' },
      pressureContours: { enabled: 'true' },
      units: { system: 'kelvin' },
    })

    const { result } = renderHook(() => useForecastSettings(), { wrapper })

    expect(result.current.settings).toEqual(DEFAULT_FORECAST_SETTINGS)
  })

  it('saves changed UI preferences', async () => {
    const { result } = renderHook(() => useForecastSettings(), { wrapper })

    act(() => {
      result.current.actions.updateRaster({ colorSamplingMode: 'banded' })
      result.current.actions.updateParticles({ enabled: false })
      result.current.actions.updatePressureContours({ enabled: true })
      result.current.actions.updateUnits({ system: 'metric' })
    })

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(FORECAST_SETTINGS_STORAGE_KEY) ?? '')).toEqual({
        raster: {
          colorSamplingMode: 'banded',
        },
        particles: {
          enabled: false,
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
