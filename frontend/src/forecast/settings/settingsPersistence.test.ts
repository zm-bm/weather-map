import { beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_FORECAST_SETTINGS,
  type ForecastSettings,
} from './settings'
import {
  FORECAST_SETTINGS_STORAGE_KEY,
  loadStoredForecastSettings,
  saveStoredForecastSettings,
} from './settingsPersistence'

describe('settingsPersistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('loads valid persisted UI preferences over defaults', () => {
    storeRawSettings({
      raster: { colorSamplingMode: 'banded' },
      particles: { enabled: false },
      pressureContours: { enabled: true },
      units: { system: 'metric' },
    })

    expect(loadStoredForecastSettings()).toEqual(expect.objectContaining({
      raster: { colorSamplingMode: 'banded' },
      particles: expect.objectContaining({ enabled: false }),
      pressureContours: { enabled: true },
      units: { system: 'metric' },
    }))
  })

  it('ignores malformed and invalid persisted settings', () => {
    storeRawSettings({
      raster: { colorSamplingMode: 'invalid' },
      particles: { enabled: 'false' },
      pressureContours: { enabled: 'true' },
      units: { system: 'kelvin' },
    })

    expect(loadStoredForecastSettings()).toEqual(DEFAULT_FORECAST_SETTINGS)
  })

  it('ignores non-persisted particle tuning fields', () => {
    storeRawSettings({
      particles: {
        enabled: false,
        clearTrailsOnViewChange: false,
        particleCount: 1,
      },
    })

    expect(loadStoredForecastSettings().particles).toEqual(expect.objectContaining({
      enabled: false,
      clearTrailsOnViewChange: DEFAULT_FORECAST_SETTINGS.particles.clearTrailsOnViewChange,
      particleCount: DEFAULT_FORECAST_SETTINGS.particles.particleCount,
    }))
  })

  it('saves only persisted UI preferences', () => {
    saveStoredForecastSettings({
      ...DEFAULT_FORECAST_SETTINGS,
      raster: { colorSamplingMode: 'banded' },
      particles: {
        ...DEFAULT_FORECAST_SETTINGS.particles,
        enabled: false,
        clearTrailsOnViewChange: false,
        particleCount: 1,
      },
      pressureContours: { enabled: true },
      units: { system: 'metric' },
    } satisfies ForecastSettings)

    expect(loadRawSettings()).toEqual({
      raster: { colorSamplingMode: 'banded' },
      particles: { enabled: false },
      pressureContours: { enabled: true },
      units: { system: 'metric' },
    })
  })
})

function storeRawSettings(value: unknown): void {
  localStorage.setItem(FORECAST_SETTINGS_STORAGE_KEY, JSON.stringify(value))
}

function loadRawSettings(): unknown {
  return JSON.parse(localStorage.getItem(FORECAST_SETTINGS_STORAGE_KEY) ?? '')
}
