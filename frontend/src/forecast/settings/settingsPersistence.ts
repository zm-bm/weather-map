import {
  loadLocalStorageJson,
  saveLocalStorageJson,
} from '@/core/storage/localStorage'
import type { UnitSystem } from '@/forecast/display/units'
import {
  DEFAULT_FORECAST_SETTINGS,
  MAP_PROJECTION_MODES,
  PARTICLE_COUNT_MAX,
  PARTICLE_COUNT_MIN,
  PARTICLE_FLOW_SPEED_SCALE_MAX,
  PARTICLE_FLOW_SPEED_SCALE_MIN,
  PARTICLE_SIZE_RATIO_MAX,
  PARTICLE_SIZE_RATIO_MIN,
  PARTICLE_TRAIL_FADE_MAX,
  PARTICLE_TRAIL_FADE_MIN,
  PARTICLE_TRAIL_OPACITY_MAX,
  PARTICLE_TRAIL_OPACITY_MIN,
  RASTER_COLOR_SAMPLING_MODES,
  RASTER_GRID_SAMPLING_MODES,
  RASTER_OPACITY_MAX,
  RASTER_OPACITY_MIN,
  type ForecastSettings,
  type MapProjectionMode,
  type ParticleSizeSettings,
  type RasterColorSamplingMode,
  type RasterGridSamplingMode,
  particleSizeSettingsForRatio,
} from './settings'

export const FORECAST_SETTINGS_STORAGE_KEY = 'weather-map:forecast-settings:v1'

type PersistedForecastSettings = {
  map: {
    projection: MapProjectionMode
    placeValueLabelsEnabled: boolean
  }
  raster: {
    gridSamplingMode: RasterGridSamplingMode
    colorSamplingMode: RasterColorSamplingMode
    opacity: number
  }
  particles: {
    enabled: boolean
    particleCount: number
    flowSpeedScale: number
    dotMinPx: number
    dotMaxPx: number
    trailCompositeOpacity: number
    trailFade: number
  }
  pressureContours: {
    enabled: boolean
  }
  units: {
    system: UnitSystem
  }
}

export function loadStoredForecastSettings(): ForecastSettings {
  const stored = loadLocalStorageJson(
    FORECAST_SETTINGS_STORAGE_KEY,
    validateStoredForecastSettings
  )

  if (!stored) return DEFAULT_FORECAST_SETTINGS

  return {
    map: {
      ...DEFAULT_FORECAST_SETTINGS.map,
      ...stored.map,
    },
    raster: {
      ...DEFAULT_FORECAST_SETTINGS.raster,
      ...stored.raster,
    },
    particles: {
      ...DEFAULT_FORECAST_SETTINGS.particles,
      ...stored.particles,
    },
    pressureContours: {
      ...DEFAULT_FORECAST_SETTINGS.pressureContours,
      ...stored.pressureContours,
    },
    units: {
      ...DEFAULT_FORECAST_SETTINGS.units,
      ...stored.units,
    },
  }
}

export function saveStoredForecastSettings(settings: ForecastSettings): void {
  saveLocalStorageJson(FORECAST_SETTINGS_STORAGE_KEY, toStoredForecastSettings(settings))
}

function toStoredForecastSettings(settings: ForecastSettings): PersistedForecastSettings {
  return {
    map: {
      projection: settings.map.projection,
      placeValueLabelsEnabled: settings.map.placeValueLabelsEnabled,
    },
    raster: {
      gridSamplingMode: settings.raster.gridSamplingMode,
      colorSamplingMode: settings.raster.colorSamplingMode,
      opacity: settings.raster.opacity,
    },
    particles: {
      enabled: settings.particles.enabled,
      particleCount: settings.particles.particleCount,
      flowSpeedScale: settings.particles.flowSpeedScale,
      dotMinPx: settings.particles.dotMinPx,
      dotMaxPx: settings.particles.dotMaxPx,
      trailCompositeOpacity: settings.particles.trailCompositeOpacity,
      trailFade: settings.particles.trailFade,
    },
    pressureContours: {
      enabled: settings.pressureContours.enabled,
    },
    units: {
      system: settings.units.system,
    },
  }
}

function validateStoredForecastSettings(value: unknown): PersistedForecastSettings | null {
  if (!isRecord(value)) return null

  const map = validMapSettings(value.map)
  if (!map) return null

  const raster = validRasterSettings(value.raster)
  if (!raster) return null

  const particles = validParticleSettings(value.particles)
  if (!particles) return null

  const pressureContours = validPressureContourSettings(value.pressureContours)
  if (!pressureContours) return null

  const units = validUnitSettings(value.units)
  if (!units) return null

  return {
    map,
    raster,
    particles,
    pressureContours,
    units,
  }
}

function validMapSettings(value: unknown): PersistedForecastSettings['map'] | null {
  if (!isRecord(value)) return null
  if (!isMapProjectionMode(value.projection)) return null
  if (typeof value.placeValueLabelsEnabled !== 'boolean') return null

  return {
    projection: value.projection,
    placeValueLabelsEnabled: value.placeValueLabelsEnabled,
  }
}

function validRasterSettings(value: unknown): PersistedForecastSettings['raster'] | null {
  if (!isRecord(value)) return null
  if (!isRasterGridSamplingMode(value.gridSamplingMode)) return null
  if (!isRasterColorSamplingMode(value.colorSamplingMode)) return null
  if (!isNumberInRange(value.opacity, RASTER_OPACITY_MIN, RASTER_OPACITY_MAX)) return null

  return {
    gridSamplingMode: value.gridSamplingMode,
    colorSamplingMode: value.colorSamplingMode,
    opacity: value.opacity,
  }
}

function validParticleSettings(value: unknown): PersistedForecastSettings['particles'] | null {
  if (!isRecord(value)) return null
  if (typeof value.enabled !== 'boolean') return null
  if (!isIntegerInRange(value.particleCount, PARTICLE_COUNT_MIN, PARTICLE_COUNT_MAX)) return null
  if (!isNumberInRange(value.flowSpeedScale, PARTICLE_FLOW_SPEED_SCALE_MIN, PARTICLE_FLOW_SPEED_SCALE_MAX)) {
    return null
  }

  const size = validParticleSizeSettings(value)
  if (!size) return null
  if (!isNumberInRange(value.trailCompositeOpacity, PARTICLE_TRAIL_OPACITY_MIN, PARTICLE_TRAIL_OPACITY_MAX)) {
    return null
  }
  if (!isNumberInRange(value.trailFade, PARTICLE_TRAIL_FADE_MIN, PARTICLE_TRAIL_FADE_MAX)) {
    return null
  }

  return {
    enabled: value.enabled,
    particleCount: value.particleCount,
    flowSpeedScale: value.flowSpeedScale,
    ...size,
    trailCompositeOpacity: value.trailCompositeOpacity,
    trailFade: value.trailFade,
  }
}

function validParticleSizeSettings(value: Record<string, unknown>): ParticleSizeSettings | null {
  const minSize = particleSizeSettingsForRatio(PARTICLE_SIZE_RATIO_MIN)
  const maxSize = particleSizeSettingsForRatio(PARTICLE_SIZE_RATIO_MAX)
  const { dotMinPx, dotMaxPx } = value
  if (!isNumberInRange(dotMinPx, minSize.dotMinPx, maxSize.dotMinPx)) return null
  if (!isNumberInRange(dotMaxPx, minSize.dotMaxPx, maxSize.dotMaxPx)) return null
  if (dotMinPx >= dotMaxPx) return null

  const dotMinRatio = dotMinPx / DEFAULT_FORECAST_SETTINGS.particles.dotMinPx
  const dotMaxRatio = dotMaxPx / DEFAULT_FORECAST_SETTINGS.particles.dotMaxPx
  if (Math.abs(dotMinRatio - dotMaxRatio) > 0.000001) return null

  return particleSizeSettingsForRatio(dotMinRatio)
}

function validPressureContourSettings(value: unknown): PersistedForecastSettings['pressureContours'] | null {
  if (!isRecord(value)) return null
  if (typeof value.enabled !== 'boolean') return null
  return {
    enabled: value.enabled,
  }
}

function validUnitSettings(value: unknown): PersistedForecastSettings['units'] | null {
  if (!isRecord(value)) return null
  if (!isUnitSystem(value.system)) return null
  return {
    system: value.system,
  }
}

function isRasterGridSamplingMode(value: unknown): value is RasterGridSamplingMode {
  return typeof value === 'string' && RASTER_GRID_SAMPLING_MODES.includes(value as RasterGridSamplingMode)
}

function isRasterColorSamplingMode(value: unknown): value is RasterColorSamplingMode {
  return typeof value === 'string' && RASTER_COLOR_SAMPLING_MODES.includes(value as RasterColorSamplingMode)
}

function isMapProjectionMode(value: unknown): value is MapProjectionMode {
  return typeof value === 'string' && MAP_PROJECTION_MODES.includes(value as MapProjectionMode)
}

function isUnitSystem(value: unknown): value is UnitSystem {
  return value === 'imperial' || value === 'metric'
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function isNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value)
}
