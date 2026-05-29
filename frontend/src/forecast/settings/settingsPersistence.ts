import {
  loadLocalStorageJson,
  saveLocalStorageJson,
} from '@/core/storage/localStorage'
import type { UnitSystem } from '@/forecast/units'
import {
  DEFAULT_FORECAST_SETTINGS,
  RASTER_COLOR_SAMPLING_MODES,
  type ForecastSettings,
  type RasterColorSamplingMode,
} from './settings'

export const FORECAST_SETTINGS_STORAGE_KEY = 'weather-map:forecast-settings:v1'

type PersistedForecastSettings = {
  raster: {
    colorSamplingMode: RasterColorSamplingMode
  }
  particles: {
    enabled: boolean
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
      colorSamplingMode: settings.raster.colorSamplingMode,
    },
    particles: {
      enabled: settings.particles.enabled,
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
  if (!isRasterColorSamplingMode(value.colorSamplingMode)) return null
  return {
    colorSamplingMode: value.colorSamplingMode,
  }
}

function validParticleSettings(value: unknown): StoredForecastSettings['particles'] | null {
  if (!isRecord(value)) return null

  const particles: NonNullable<StoredForecastSettings['particles']> = {}
  if (typeof value.enabled === 'boolean') particles.enabled = value.enabled

  return Object.keys(particles).length > 0 ? particles : null
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

function isRasterColorSamplingMode(value: unknown): value is RasterColorSamplingMode {
  return typeof value === 'string' && RASTER_COLOR_SAMPLING_MODES.includes(value as RasterColorSamplingMode)
}

function isUnitSystem(value: unknown): value is UnitSystem {
  return value === 'imperial' || value === 'metric'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value)
}
