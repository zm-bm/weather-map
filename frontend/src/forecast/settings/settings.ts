import type { UnitSystem } from '@/forecast/display/units'

export const RASTER_COLOR_SAMPLING_MODES = ['interpolated', 'banded'] as const

export type RasterColorSamplingMode = typeof RASTER_COLOR_SAMPLING_MODES[number]

export type RasterRenderSettings = {
  colorSamplingMode: RasterColorSamplingMode
}

export const DEFAULT_RASTER_RENDER_SETTINGS: Readonly<RasterRenderSettings> = {
  colorSamplingMode: 'interpolated',
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
