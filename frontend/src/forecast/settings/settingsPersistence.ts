import {
  loadLocalStorageJson,
  saveLocalStorageJson,
} from '@/core/storage/localStorage'
import type { UnitSystem } from '@/forecast/display/units'
import {
  DEFAULT_FORECAST_SETTINGS,
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
  type ParticleSizeSettings,
  type RasterColorSamplingMode,
  type RasterGridSamplingMode,
  particleSizeSettingsForRatio,
} from './settings'

export const FORECAST_SETTINGS_STORAGE_KEY = 'weather-map:forecast-settings:v1'

type PersistedForecastSettings = {
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

type StoredForecastSettings = {
  [Group in keyof PersistedForecastSettings]?: Partial<PersistedForecastSettings[Group]>
}

export function loadStoredForecastSettings(): ForecastSettings {
  const stored = loadLocalStorageJson(
    FORECAST_SETTINGS_STORAGE_KEY,
    validateStoredForecastSettings
  )

  return {
    raster: {
      ...DEFAULT_FORECAST_SETTINGS.raster,
      ...stored?.raster,
    },
    particles: {
      ...DEFAULT_FORECAST_SETTINGS.particles,
      ...stored?.particles,
    },
    pressureContours: {
      ...DEFAULT_FORECAST_SETTINGS.pressureContours,
      ...stored?.pressureContours,
    },
    units: {
      ...DEFAULT_FORECAST_SETTINGS.units,
      ...stored?.units,
    },
  }
}

export function saveStoredForecastSettings(settings: ForecastSettings): void {
  saveLocalStorageJson(FORECAST_SETTINGS_STORAGE_KEY, toStoredForecastSettings(settings))
}

function toStoredForecastSettings(settings: ForecastSettings): PersistedForecastSettings {
  return {
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

function validateStoredForecastSettings(value: unknown): StoredForecastSettings | null {
  if (!isRecord(value)) return null

  const settings: StoredForecastSettings = {}

  const raster = validRasterSettings(value.raster)
  if (raster) settings.raster = raster

  const particles = validParticleSettings(value.particles)
  if (particles) settings.particles = particles

  const pressureContours = validPressureContourSettings(value.pressureContours)
  if (pressureContours) settings.pressureContours = pressureContours

  const units = validUnitSettings(value.units)
  if (units) settings.units = units

  return Object.keys(settings).length > 0 ? settings : null
}

function validRasterSettings(value: unknown): StoredForecastSettings['raster'] | null {
  if (!isRecord(value)) return null

  const raster: NonNullable<StoredForecastSettings['raster']> = {}
  if (isRasterGridSamplingMode(value.gridSamplingMode)) {
    raster.gridSamplingMode = value.gridSamplingMode
  }
  if (isRasterColorSamplingMode(value.colorSamplingMode)) {
    raster.colorSamplingMode = value.colorSamplingMode
  }
  if (isNumberInRange(value.opacity, RASTER_OPACITY_MIN, RASTER_OPACITY_MAX)) {
    raster.opacity = value.opacity
  }

  return Object.keys(raster).length > 0 ? raster : null
}

function validParticleSettings(value: unknown): StoredForecastSettings['particles'] | null {
  if (!isRecord(value)) return null

  const particles: NonNullable<StoredForecastSettings['particles']> = {}
  if (typeof value.enabled === 'boolean') particles.enabled = value.enabled
  if (isIntegerInRange(value.particleCount, PARTICLE_COUNT_MIN, PARTICLE_COUNT_MAX)) {
    particles.particleCount = value.particleCount
  }
  if (isNumberInRange(value.flowSpeedScale, PARTICLE_FLOW_SPEED_SCALE_MIN, PARTICLE_FLOW_SPEED_SCALE_MAX)) {
    particles.flowSpeedScale = value.flowSpeedScale
  }
  const size = validParticleSizeSettings(value)
  if (size) {
    particles.dotMinPx = size.dotMinPx
    particles.dotMaxPx = size.dotMaxPx
  }
  if (isNumberInRange(value.trailCompositeOpacity, PARTICLE_TRAIL_OPACITY_MIN, PARTICLE_TRAIL_OPACITY_MAX)) {
    particles.trailCompositeOpacity = value.trailCompositeOpacity
  }
  if (isNumberInRange(value.trailFade, PARTICLE_TRAIL_FADE_MIN, PARTICLE_TRAIL_FADE_MAX)) {
    particles.trailFade = value.trailFade
  }

  return Object.keys(particles).length > 0 ? particles : null
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

function validPressureContourSettings(value: unknown): StoredForecastSettings['pressureContours'] | null {
  if (!isRecord(value)) return null
  if (typeof value.enabled !== 'boolean') return null
  return {
    enabled: value.enabled,
  }
}

function validUnitSettings(value: unknown): StoredForecastSettings['units'] | null {
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
