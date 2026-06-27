import { beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_FORECAST_SETTINGS,
  particleSizeSettingsForRatio,
  particleTrailFadeFromLength,
  type ForecastSettings,
} from './settings'
import {
  FORECAST_SETTINGS_STORAGE_KEY,
  loadStoredForecastSettings,
  saveStoredForecastSettings,
} from './settingsPersistence'

const PARTICLE_SIZE = particleSizeSettingsForRatio(1.25)
const TRAIL_FADE = particleTrailFadeFromLength(5)

describe('settingsPersistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('loads defaults when no settings are stored', () => {
    expect(loadStoredForecastSettings()).toEqual(DEFAULT_FORECAST_SETTINGS)
  })

  it('loads valid persisted UI preferences over defaults', () => {
    storeRawSettings({
      map: { projection: 'mercator', placeValueLabelsEnabled: false },
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

    expect(loadStoredForecastSettings()).toEqual(expect.objectContaining({
      map: { projection: 'mercator', placeValueLabelsEnabled: false },
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

  it('falls back to defaults for malformed, partial, or invalid persisted settings', () => {
    const invalidValues: unknown[] = [
      {
        map: { projection: 'mercator', placeValueLabelsEnabled: false },
      },
      {
        map: { projection: 'orthographic', placeValueLabelsEnabled: 'false' },
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
      },
      {
        map: { projection: 'mercator', placeValueLabelsEnabled: false },
        raster: { gridSamplingMode: 'nearest', colorSamplingMode: 'banded', opacity: 0.65 },
        particles: {
          enabled: false,
          particleCount: 11000,
          flowSpeedScale: 7200,
          dotMinPx: particleSizeSettingsForRatio(0.75).dotMinPx,
          dotMaxPx: particleSizeSettingsForRatio(1.5).dotMaxPx,
          trailCompositeOpacity: 0.45,
          trailFade: TRAIL_FADE,
        },
        pressureContours: { enabled: true },
        units: { system: 'metric' },
      },
    ]

    for (const value of invalidValues) {
      storeRawSettings(value)
      expect(loadStoredForecastSettings()).toEqual(DEFAULT_FORECAST_SETTINGS)
      localStorage.clear()
    }

    localStorage.setItem(FORECAST_SETTINGS_STORAGE_KEY, '{')
    expect(loadStoredForecastSettings()).toEqual(DEFAULT_FORECAST_SETTINGS)
  })

  it('saves only persisted UI preferences', () => {
    saveStoredForecastSettings({
      ...DEFAULT_FORECAST_SETTINGS,
      map: { projection: 'mercator', placeValueLabelsEnabled: false },
      raster: { gridSamplingMode: 'nearest', colorSamplingMode: 'banded', opacity: 0.75 },
      particles: {
        ...DEFAULT_FORECAST_SETTINGS.particles,
        enabled: false,
        clearTrailsOnViewChange: false,
        particleCount: 15000,
        flowSpeedScale: 8800,
        ...PARTICLE_SIZE,
        trailCompositeOpacity: 0.45,
        trailFade: TRAIL_FADE,
      },
      pressureContours: { enabled: true },
      units: { system: 'metric' },
    } satisfies ForecastSettings)

    expect(loadRawSettings()).toEqual({
      map: { projection: 'mercator', placeValueLabelsEnabled: false },
      raster: { gridSamplingMode: 'nearest', colorSamplingMode: 'banded', opacity: 0.75 },
      particles: {
        enabled: false,
        particleCount: 15000,
        flowSpeedScale: 8800,
        ...PARTICLE_SIZE,
        trailCompositeOpacity: 0.45,
        trailFade: TRAIL_FADE,
      },
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
