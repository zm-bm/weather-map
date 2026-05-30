import {
  AIR_TEMPERATURE_PALETTE,
  CAPE_PALETTE,
  CIN_PALETTE,
  CLOUD_COVER_PALETTE,
  CLOUD_HIGH_PALETTE,
  CLOUD_LOW_PALETTE,
  CLOUD_MIDDLE_PALETTE,
  DEW_POINT_PALETTE,
  FREEZING_LEVEL_PALETTE,
  PRECIPITABLE_WATER_PALETTE,
  PRECIP_RATE_PALETTE,
  PRECIP_TOTAL_PALETTE,
  PRESSURE_PALETTE,
  REFLECTIVITY_PALETTE,
  RELATIVE_HUMIDITY_PALETTE,
  SNOW_DEPTH_PALETTE,
  type RasterPaletteDefinition,
  VISIBILITY_PALETTE,
  WIND_SPEED_PALETTE,
} from './palette'
import type {
  GradientUnitOption,
  UnitDisplay,
  UnitOption,
} from './units'

export const DISPLAY_PROFILE_IDS = [
  'temperature',
  'apparent-temperature',
  'dew-point',
  'relative-humidity',
  'wind-speed',
  'wind-gust',
  'air-pressure',
  'precipitation-rate',
  'accumulated-precipitation',
  'snow-depth',
  'cloud-layers',
  'cloud-cover',
  'visibility',
  'freezing-level',
  'precipitable-water',
  'composite-reflectivity',
  'cape',
  'cin',
] as const

export type DisplayProfileId = typeof DISPLAY_PROFILE_IDS[number]

export type DisplayRange = {
  min: number
  max: number
}

export type GradientDisplayProfile = {
  kind: 'gradient'
  label: string
  range: DisplayRange
  units: UnitDisplay<GradientUnitOption>
  palette: RasterPaletteDefinition
  parameter?: string
}

export type CloudLayersDisplayProfile = {
  kind: 'cloud-layers'
  label: string
  range: DisplayRange
  units: UnitDisplay<UnitOption>
  bandPalettes: Record<string, RasterPaletteDefinition>
  parameter?: string
}

export type ForecastDisplayProfile =
  | GradientDisplayProfile
  | CloudLayersDisplayProfile

const DISPLAY_PROFILE_ID_SET = new Set<string>(DISPLAY_PROFILE_IDS)

const TEMPERATURE_UNITS: UnitDisplay<GradientUnitOption> = {
  options: [{
    id: 'fahrenheit',
    label: 'F',
    system: 'imperial',
    scale: 9 / 5,
    offset: 32,
    valueFormat: 'whole',
    legendValueFormat: 'whole',
    legendLabels: [-40, -20, 0, 20, 40, 60, 80, 100, 120],
  },
  {
    id: 'celsius',
    label: 'C',
    system: 'metric',
    valueFormat: 'whole',
    legendValueFormat: 'whole',
    legendLabels: [-40, -30, -20, -10, 0, 10, 20, 30, 40, 50],
  }],
}

const DEW_POINT_UNITS: UnitDisplay<GradientUnitOption> = {
  options: [{
    id: 'fahrenheit',
    label: 'F',
    system: 'imperial',
    scale: 9 / 5,
    offset: 32,
    valueFormat: 'whole',
    legendValueFormat: 'whole',
    legendLabels: [-20, 0, 20, 40, 50, 60, 70, 80, 90],
  },
  {
    id: 'celsius',
    label: 'C',
    system: 'metric',
    valueFormat: 'whole',
    legendValueFormat: 'whole',
    legendLabels: [-30, -20, -10, 0, 10, 15, 20, 25, 30],
  }],
}

const PERCENT_UNITS: UnitDisplay<GradientUnitOption> = {
  options: [{
    id: 'percent',
    label: '%',
    valueFormat: 'whole',
    legendValueFormat: 'whole',
    legendLabels: [0, 20, 40, 60, 80, 100],
  }],
}

const WIND_SPEED_UNITS: UnitDisplay<GradientUnitOption> = {
  options: [{
    id: 'miles_per_hour',
    label: 'mph',
    system: 'imperial',
    scale: 2.2369362920544,
    valueFormat: 'whole',
    legendLabels: [0, 20, 40, 60, 80, 120],
  },
  {
    id: 'kilometers_per_hour',
    label: 'km/h',
    system: 'metric',
    scale: 3.6,
    valueFormat: 'whole',
    legendLabels: [0, 40, 80, 120, 160, 220],
  }],
}

const PRESSURE_UNITS: UnitDisplay<GradientUnitOption> = {
  options: [{
    id: 'hectopascal',
    label: 'hPa',
    scale: 0.01,
    valueFormat: 'whole',
    legendValueFormat: 'whole',
    legendLabels: [980, 992, 1004, 1016, 1028, 1036],
  }],
}

const PRECIP_RATE_UNITS: UnitDisplay<GradientUnitOption> = {
  options: [{
    id: 'in_per_hour',
    label: 'in/hr',
    system: 'imperial',
    scale: 1 / 25.4,
    valueFormat: 'fixed-2',
    legendValueFormat: 'precip-rate',
    legendLabels: [0, 0.03, 0.1, 0.3, 0.7, { value: 1, label: '1.0' }],
  },
  {
    id: 'mm_per_hour',
    label: 'mm/hr',
    system: 'metric',
    valueFormat: 'fixed-2',
    legendValueFormat: 'precip-rate',
    legendLabels: [0, 1, 3, 7, 15, 30],
  }],
}

const PRECIP_TOTAL_UNITS: UnitDisplay<GradientUnitOption> = {
  options: [{
    id: 'inches',
    label: 'in',
    system: 'imperial',
    scale: 1 / 25.4,
    valueFormat: 'one-decimal',
    legendLabels: [0, 0.5, 1, 2, 4, 6, 10],
  },
  {
    id: 'millimeters',
    label: 'mm',
    system: 'metric',
    valueFormat: 'one-decimal',
    legendLabels: [0, 10, 25, 50, 100, 150, 250],
  }],
}

const SNOW_DEPTH_UNITS: UnitDisplay<GradientUnitOption> = {
  options: [{
    id: 'inches',
    label: 'in',
    system: 'imperial',
    scale: 39.37007874015748,
    valueFormat: 'whole',
    legendLabels: [
      0,
      { value: 1, label: '1in' },
      { value: 2, label: '2in' },
      { value: 4, label: '4in' },
      { value: 20, label: '20in' },
      { value: 36, label: '3ft' },
      { value: 108, label: '9ft' },
    ],
  },
  {
    id: 'centimeters',
    label: 'cm',
    system: 'metric',
    scale: 100,
    valueFormat: 'whole',
    legendLabels: [0, 2, 5, 10, 50, { value: 100, label: '1m' }, { value: 300, label: '3m' }],
  }],
}

const VISIBILITY_UNITS: UnitDisplay<GradientUnitOption> = {
  options: [{
    id: 'miles',
    label: 'mi',
    system: 'imperial',
    scale: 1 / 1609.344,
    valueFormat: 'one-decimal',
    legendLabels: [0, 1, 3, 6, 12, 30],
  },
  {
    id: 'kilometers',
    label: 'km',
    system: 'metric',
    scale: 1 / 1000,
    valueFormat: 'one-decimal',
    legendLabels: [0, 1, 5, 10, 20, 50],
  }],
}

const HEIGHT_UNITS: UnitDisplay<GradientUnitOption> = {
  options: [{
    id: 'feet',
    label: 'ft',
    system: 'imperial',
    scale: 3.280839895013123,
    valueFormat: 'whole',
    legendLabels: [0, 3000, 6000, 10000, 16000, 26000],
  },
  {
    id: 'meters',
    label: 'm',
    system: 'metric',
    valueFormat: 'whole',
    legendLabels: [0, 1000, 2000, 3000, 5000, 8000],
  }],
}

const WATER_DEPTH_UNITS: UnitDisplay<GradientUnitOption> = {
  options: [{
    id: 'inches',
    label: 'in',
    system: 'imperial',
    scale: 1 / 25.4,
    valueFormat: 'one-decimal',
    legendLabels: [0, 0.5, 1, 1.5, 2, 2.5, 3],
  },
  {
    id: 'millimeters',
    label: 'mm',
    system: 'metric',
    valueFormat: 'one-decimal',
    legendLabels: [0, 10, 20, 30, 40, 60, 80],
  }],
}

const ENERGY_PER_MASS_UNITS: UnitDisplay<GradientUnitOption> = {
  options: [{
    id: 'joules_per_kilogram',
    label: 'J/kg',
    valueFormat: 'whole',
    legendLabels: [0, 500, 1000, 1500, 2500, 3500, 5000],
  }],
}

const REFLECTIVITY_UNITS: UnitDisplay<GradientUnitOption> = {
  options: [{
    id: 'dbz',
    label: 'dBZ',
    valueFormat: 'whole',
    legendLabels: [0, 10, 20, 30, 40, 50, 60, 70, 75],
  }],
}

const CIN_UNITS: UnitDisplay<GradientUnitOption> = {
  options: [{
    id: 'joules_per_kilogram',
    label: 'J/kg',
    valueFormat: 'whole',
    legendLabels: [0, 25, 50, 100, 200, 300, 500],
  }],
}

export const FORECAST_DISPLAY_PROFILES = {
  temperature: {
    kind: 'gradient',
    label: 'Temperature',
    range: { min: -35, max: 50 },
    units: TEMPERATURE_UNITS,
    palette: AIR_TEMPERATURE_PALETTE,
  },
  'apparent-temperature': {
    kind: 'gradient',
    label: 'Apparent Temperature',
    range: { min: -35, max: 50 },
    units: TEMPERATURE_UNITS,
    palette: AIR_TEMPERATURE_PALETTE,
  },
  'dew-point': {
    kind: 'gradient',
    label: 'Dew Point',
    range: { min: -60, max: 40 },
    units: DEW_POINT_UNITS,
    palette: DEW_POINT_PALETTE,
  },
  'relative-humidity': {
    kind: 'gradient',
    label: 'Relative Humidity',
    range: { min: 0, max: 100 },
    units: PERCENT_UNITS,
    palette: RELATIVE_HUMIDITY_PALETTE,
  },
  'wind-speed': {
    kind: 'gradient',
    label: 'Wind Speed',
    range: { min: 0, max: 60 },
    units: WIND_SPEED_UNITS,
    palette: WIND_SPEED_PALETTE,
    parameter: 'wind_speed',
  },
  'wind-gust': {
    kind: 'gradient',
    label: 'Wind Gust',
    range: { min: 0, max: 60 },
    units: WIND_SPEED_UNITS,
    palette: WIND_SPEED_PALETTE,
  },
  'air-pressure': {
    kind: 'gradient',
    label: 'Air Pressure',
    range: { min: 98000, max: 103600 },
    units: PRESSURE_UNITS,
    palette: PRESSURE_PALETTE,
  },
  'precipitation-rate': {
    kind: 'gradient',
    label: 'Precipitation Rate',
    range: { min: 0, max: 30 },
    units: PRECIP_RATE_UNITS,
    palette: PRECIP_RATE_PALETTE,
  },
  'accumulated-precipitation': {
    kind: 'gradient',
    label: 'Run-Total Precipitation',
    range: { min: 0, max: 254 },
    units: PRECIP_TOTAL_UNITS,
    palette: PRECIP_TOTAL_PALETTE,
  },
  'snow-depth': {
    kind: 'gradient',
    label: 'Snow Depth',
    range: { min: 0, max: 3 },
    units: SNOW_DEPTH_UNITS,
    palette: SNOW_DEPTH_PALETTE,
  },
  'cloud-layers': {
    kind: 'cloud-layers',
    label: 'Cloud Layers',
    range: { min: 0, max: 100 },
    units: PERCENT_UNITS,
    bandPalettes: {
      low: CLOUD_LOW_PALETTE,
      middle: CLOUD_MIDDLE_PALETTE,
      high: CLOUD_HIGH_PALETTE,
    },
    parameter: 'cloud_layers',
  },
  'cloud-cover': {
    kind: 'gradient',
    label: 'Total/Sky Cover',
    range: { min: 0, max: 100 },
    units: PERCENT_UNITS,
    palette: CLOUD_COVER_PALETTE,
  },
  visibility: {
    kind: 'gradient',
    label: 'Visibility',
    range: { min: 0, max: 50000 },
    units: VISIBILITY_UNITS,
    palette: VISIBILITY_PALETTE,
  },
  'freezing-level': {
    kind: 'gradient',
    label: 'Freezing Level',
    range: { min: 0, max: 8000 },
    units: HEIGHT_UNITS,
    palette: FREEZING_LEVEL_PALETTE,
  },
  'precipitable-water': {
    kind: 'gradient',
    label: 'Precipitable Water',
    range: { min: 0, max: 80 },
    units: WATER_DEPTH_UNITS,
    palette: PRECIPITABLE_WATER_PALETTE,
  },
  'composite-reflectivity': {
    kind: 'gradient',
    label: 'Simulated Radar',
    range: { min: 0, max: 75 },
    units: REFLECTIVITY_UNITS,
    palette: REFLECTIVITY_PALETTE,
  },
  cape: {
    kind: 'gradient',
    label: 'CAPE Index',
    range: { min: 0, max: 5000 },
    units: ENERGY_PER_MASS_UNITS,
    palette: CAPE_PALETTE,
  },
  cin: {
    kind: 'gradient',
    label: 'CIN',
    range: { min: 0, max: 500 },
    units: CIN_UNITS,
    palette: CIN_PALETTE,
  },
} satisfies Record<DisplayProfileId, ForecastDisplayProfile>

export function isDisplayProfileId(value: unknown): value is DisplayProfileId {
  return typeof value === 'string' && DISPLAY_PROFILE_ID_SET.has(value)
}

export function getDisplayProfile(id: DisplayProfileId): ForecastDisplayProfile {
  return FORECAST_DISPLAY_PROFILES[id]
}
