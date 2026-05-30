import type { UnitSystem } from '@/forecast/display/units'

export const RASTER_COLOR_SAMPLING_MODES = ['interpolated', 'banded'] as const

export type RasterColorSamplingMode = typeof RASTER_COLOR_SAMPLING_MODES[number]

export const RASTER_OPACITY_MIN = 0.35
export const RASTER_OPACITY_MAX = 1
export const RASTER_OPACITY_STEP = 0.05

export const PARTICLE_COUNT_MIN = 3000
export const PARTICLE_COUNT_MAX = 18000
export const PARTICLE_COUNT_STEP = 1000

export const PARTICLE_FLOW_SPEED_SCALE_MIN = 3200
export const PARTICLE_FLOW_SPEED_SCALE_MAX = 9600
export const PARTICLE_FLOW_SPEED_RATIO_MIN = 0.5
export const PARTICLE_FLOW_SPEED_RATIO_MAX = 1.5
export const PARTICLE_FLOW_SPEED_RATIO_STEP = 0.1

export const PARTICLE_SIZE_RATIO_MIN = 0.75
export const PARTICLE_SIZE_RATIO_MAX = 1.5
export const PARTICLE_SIZE_RATIO_STEP = 0.05

export const PARTICLE_TRAIL_OPACITY_MIN = 0.1
export const PARTICLE_TRAIL_OPACITY_MAX = 0.6
export const PARTICLE_TRAIL_OPACITY_STEP = 0.05

export const PARTICLE_TRAIL_LENGTH_MIN = 1
export const PARTICLE_TRAIL_LENGTH_MAX = 10
export const PARTICLE_TRAIL_LENGTH_STEP = 1
export const PARTICLE_TRAIL_FADE_MIN = 0.94
export const PARTICLE_TRAIL_FADE_MAX = 0.992

export type RasterRenderSettings = {
  colorSamplingMode: RasterColorSamplingMode
  opacity: number
}

export const DEFAULT_RASTER_RENDER_SETTINGS: Readonly<RasterRenderSettings> = {
  colorSamplingMode: 'interpolated',
  opacity: 0.9,
}

export type ParticleColor = readonly [number, number, number, number]

export type ParticleRenderSettings = {
  reseedOnFrameChange: boolean
  particleCount: number
  maxAgeSec: number
  fadeInAgeRatio: number
  fadeOutAgeRatio: number
  respawnBasePerSec: number
  respawnSpeedPerMps: number
  jitterRatio: number
  motionSpeedFloorMps: number
  stagnationFadeStartMps: number
  stagnationFadeEndMps: number
  stagnationRespawnStartMps: number
  stagnationRespawnEndMps: number
  stagnationRespawnPerSec: number
  simulationViewportPaddingRatio: number
  flowSpeedScale: number
  flowRefZoom: number
  zoomOutRespawnFraction: number
  zoomOutRespawnMinDelta: number
  dotMinPx: number
  dotMaxPx: number
  speedRampGamma: number
  coreSlow: ParticleColor
  coreFast: ParticleColor
  trailScale: number
  trailFade: number
  trailQuantize: boolean
  trailCompositeOpacity: number
  clearTrailsOnViewChange: boolean
}

export const DEFAULT_PARTICLE_RENDER_SETTINGS: Readonly<ParticleRenderSettings> = {
  // Reseed all particles whenever new particle data is applied.
  reseedOnFrameChange: false,
  // Number of simulated particles.
  particleCount: 9000,
  // Maximum particle lifetime before forced respawn.
  maxAgeSec: 4.5,
  // Fraction of particle lifetime used to fade in after spawn.
  fadeInAgeRatio: 0.05,
  // Fraction of particle lifetime used to fade out before expiry.
  fadeOutAgeRatio: 0.26,
  // Baseline random respawn chance per second.
  respawnBasePerSec: 0.06,
  // Extra respawn chance per m/s of local flow speed.
  respawnSpeedPerMps: 0.0001,
  // Perpendicular stochastic wobble as a fraction of local speed.
  jitterRatio: 0.015,
  // Minimum visual advection speed for non-calm flow.
  motionSpeedFloorMps: 3.5,
  // Visual fade range for near-calm particles.
  stagnationFadeStartMps: 0.12,
  stagnationFadeEndMps: 0.85,
  // Extra turnover for particles trapped in near-calm flow.
  stagnationRespawnStartMps: 0.08,
  stagnationRespawnEndMps: 0.65,
  stagnationRespawnPerSec: 1.0,
  // Fractional viewport padding used for particle spawn/cull bounds.
  simulationViewportPaddingRatio: 0.05,
  // World-space advection scaling.
  flowSpeedScale: 6400,
  // Reference zoom used to normalize flowSpeedScale.
  flowRefZoom: 5,
  // Fraction of particles to forcibly respawn after a zoom-out gesture.
  zoomOutRespawnFraction: 0.85,
  // Minimum net zoom-out delta required to trigger zoomOutRespawnFraction.
  zoomOutRespawnMinDelta: 0.05,

  // Minimum rendered dot diameter in pixels.
  dotMinPx: 1.5,
  // Maximum rendered dot diameter in pixels.
  dotMaxPx: 2.8,

  // Non-linear mapping from normalized speed to ramp colors (1 = linear).
  speedRampGamma: 1.0,
  // Core color at low speed.
  coreSlow: [0.9, 0.94, 1.0, 0.12],
  // Core color at high speed.
  coreFast: [1.0, 1.0, 1.0, 0.18],

  // Trail render target scale relative to drawing buffer size.
  trailScale: 0.99,
  // Multiplicative fade applied each frame to previous trail texture.
  trailFade: 0.98,
  // Quantize faded trails to reduce ghost pixels.
  trailQuantize: true,
  // Opacity used when compositing trails back onto the map.
  trailCompositeOpacity: 0.30,
  // Clear trail history when camera/viewport changes.
  clearTrailsOnViewChange: true,
}

export type ParticleSizeSettings = Pick<ParticleRenderSettings, 'dotMinPx' | 'dotMaxPx'>

export function particleSizeSettingsForRatio(ratio: number): ParticleSizeSettings {
  const clampedRatio = clampNumber(ratio, PARTICLE_SIZE_RATIO_MIN, PARTICLE_SIZE_RATIO_MAX)
  return {
    dotMinPx: roundParticleSetting(DEFAULT_PARTICLE_RENDER_SETTINGS.dotMinPx * clampedRatio),
    dotMaxPx: roundParticleSetting(DEFAULT_PARTICLE_RENDER_SETTINGS.dotMaxPx * clampedRatio),
  }
}

export function particleSizeRatioForSettings(settings: ParticleSizeSettings): number {
  return roundParticleSetting(
    clampNumber(
      settings.dotMinPx / DEFAULT_PARTICLE_RENDER_SETTINGS.dotMinPx,
      PARTICLE_SIZE_RATIO_MIN,
      PARTICLE_SIZE_RATIO_MAX,
    )
  )
}

export function particleTrailFadeFromLength(value: number): number {
  const clampedValue = clampNumber(value, PARTICLE_TRAIL_LENGTH_MIN, PARTICLE_TRAIL_LENGTH_MAX)
  const range = PARTICLE_TRAIL_LENGTH_MAX - PARTICLE_TRAIL_LENGTH_MIN
  const progress = range <= 0 ? 0 : (clampedValue - PARTICLE_TRAIL_LENGTH_MIN) / range
  return roundParticleSetting(
    PARTICLE_TRAIL_FADE_MIN + progress * (PARTICLE_TRAIL_FADE_MAX - PARTICLE_TRAIL_FADE_MIN)
  )
}

export function particleTrailLengthFromFade(value: number): number {
  const clampedValue = clampNumber(value, PARTICLE_TRAIL_FADE_MIN, PARTICLE_TRAIL_FADE_MAX)
  const range = PARTICLE_TRAIL_FADE_MAX - PARTICLE_TRAIL_FADE_MIN
  const progress = range <= 0 ? 0 : (clampedValue - PARTICLE_TRAIL_FADE_MIN) / range
  return Math.round(
    PARTICLE_TRAIL_LENGTH_MIN + progress * (PARTICLE_TRAIL_LENGTH_MAX - PARTICLE_TRAIL_LENGTH_MIN)
  )
}

export type ForecastRenderSettings = {
  raster: RasterRenderSettings
  particles: ParticleRenderSettings
}

export type ParticleSettings = ParticleRenderSettings & {
  enabled: boolean
}

export type PressureContourSettings = {
  enabled: boolean
}

export type UnitSettings = {
  system: UnitSystem
}

export type ForecastSettings = {
  raster: RasterRenderSettings
  particles: ParticleSettings
  pressureContours: PressureContourSettings
  units: UnitSettings
}

export type ForecastSettingsActions = {
  updateRaster: (patch: Partial<RasterRenderSettings>) => void
  updateParticles: (patch: Partial<ParticleSettings>) => void
  updatePressureContours: (patch: Partial<PressureContourSettings>) => void
  updateUnits: (patch: Partial<UnitSettings>) => void
  toggleUnitSystem: () => void
}

export type ForecastSettingsValue = {
  settings: ForecastSettings
  actions: ForecastSettingsActions
}

export const DEFAULT_FORECAST_SETTINGS = {
  raster: {
    ...DEFAULT_RASTER_RENDER_SETTINGS,
  },
  particles: {
    enabled: true,
    ...DEFAULT_PARTICLE_RENDER_SETTINGS,
  },
  pressureContours: {
    enabled: false,
  },
  units: {
    system: 'imperial',
  },
} as const satisfies ForecastSettings

function roundParticleSetting(value: number): number {
  return Number(value.toFixed(6))
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}
