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

  it('loads valid persisted UI preferences over defaults', () => {
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

    expect(loadStoredForecastSettings()).toEqual(expect.objectContaining({
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

  it('ignores malformed and invalid persisted settings', () => {
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

    expect(loadStoredForecastSettings()).toEqual(DEFAULT_FORECAST_SETTINGS)
  })

  it('loads persisted particle map controls but ignores lower-level tuning fields', () => {
    storeRawSettings({
      particles: {
        enabled: false,
        clearTrailsOnViewChange: false,
        particleCount: 12000,
        flowSpeedScale: 8000,
        ...PARTICLE_SIZE,
        trailCompositeOpacity: 0.45,
        trailFade: TRAIL_FADE,
      },
    })

    expect(loadStoredForecastSettings().particles).toEqual(expect.objectContaining({
      enabled: false,
      clearTrailsOnViewChange: DEFAULT_FORECAST_SETTINGS.particles.clearTrailsOnViewChange,
      particleCount: 12000,
      flowSpeedScale: 8000,
      ...PARTICLE_SIZE,
      trailCompositeOpacity: 0.45,
      trailFade: TRAIL_FADE,
    }))
  })

  it('drops paired particle size settings when the pair is incoherent', () => {
    storeRawSettings({
      particles: {
        enabled: false,
        dotMinPx: particleSizeSettingsForRatio(0.75).dotMinPx,
        dotMaxPx: particleSizeSettingsForRatio(1.5).dotMaxPx,
        trailCompositeOpacity: 0.45,
      },
    })

    expect(loadStoredForecastSettings().particles).toEqual(expect.objectContaining({
      enabled: false,
      dotMinPx: DEFAULT_FORECAST_SETTINGS.particles.dotMinPx,
      dotMaxPx: DEFAULT_FORECAST_SETTINGS.particles.dotMaxPx,
      trailCompositeOpacity: 0.45,
    }))
  })

  it('ignores out-of-range persisted map controls', () => {
    storeRawSettings({
      raster: {
        gridSamplingMode: 'nearest',
        colorSamplingMode: 'banded',
        opacity: 0.1,
      },
      particles: {
        enabled: false,
        particleCount: 50000,
        flowSpeedScale: 30000,
        dotMinPx: 100,
        dotMaxPx: -1,
        trailCompositeOpacity: 2,
        trailFade: 0.5,
      },
    })

    expect(loadStoredForecastSettings()).toEqual(expect.objectContaining({
      raster: {
        gridSamplingMode: 'nearest',
        colorSamplingMode: 'banded',
        opacity: DEFAULT_FORECAST_SETTINGS.raster.opacity,
      },
      particles: expect.objectContaining({
        enabled: false,
        particleCount: DEFAULT_FORECAST_SETTINGS.particles.particleCount,
        flowSpeedScale: DEFAULT_FORECAST_SETTINGS.particles.flowSpeedScale,
        dotMinPx: DEFAULT_FORECAST_SETTINGS.particles.dotMinPx,
        dotMaxPx: DEFAULT_FORECAST_SETTINGS.particles.dotMaxPx,
        trailCompositeOpacity: DEFAULT_FORECAST_SETTINGS.particles.trailCompositeOpacity,
        trailFade: DEFAULT_FORECAST_SETTINGS.particles.trailFade,
      }),
    }))
  })

  it('saves only persisted UI preferences', () => {
    saveStoredForecastSettings({
      ...DEFAULT_FORECAST_SETTINGS,
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
