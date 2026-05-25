import type { UnitSystem } from '@/forecast/units'

export const FIELD_COLOR_SAMPLING_MODES = ['interpolated', 'banded'] as const

export type FieldColorSamplingMode = typeof FIELD_COLOR_SAMPLING_MODES[number]

export type FieldRenderSettings = {
  colorSamplingMode: FieldColorSamplingMode
}

export const DEFAULT_FIELD_RENDER_SETTINGS: Readonly<FieldRenderSettings> = {
  colorSamplingMode: 'banded',
}

export type ParticleColor = readonly [number, number, number, number]

export type ParticleRenderSettings = {
  reseedOnFrameChange: boolean
  particleCount: number
  maxAgeSec: number
  respawnBasePerSec: number
  respawnSpeedPerMps: number
  jitterRatio: number
  motionSpeedFloorMps: number
  simulationViewportPaddingRatio: number
  flowSpeedScale: number
  flowRefZoom: number
  zoomOutRespawnFraction: number
  zoomOutRespawnMinDelta: number
  pointSizePx: number
  dashMinPx: number
  dashMaxPx: number
  dashPerMps: number
  coreWidthPx: number
  shadowWidthPx: number
  dirSampleStepSec: number
  speedRampGamma: number
  coreSlow: ParticleColor
  coreFast: ParticleColor
  shadowSlow: ParticleColor
  shadowFast: ParticleColor
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
  particleCount: 10000,
  // Maximum particle lifetime before forced respawn.
  maxAgeSec: 10,
  // Baseline random respawn chance per second.
  respawnBasePerSec: 0.1,
  // Extra respawn chance per m/s of local flow speed.
  respawnSpeedPerMps: 0.025,
  // Perpendicular stochastic wobble as a fraction of local speed.
  jitterRatio: 0.2,
  // Minimum visual advection speed for non-calm flow.
  motionSpeedFloorMps: 5,
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

  // Point size used for each dash draw call.
  pointSizePx: 20,
  // Minimum dash length in pixels.
  dashMinPx: 8,
  // Maximum dash length in pixels.
  dashMaxPx: 12,
  // Additional dash length per m/s.
  dashPerMps: 0.05,
  // Core (foreground) dash stroke width.
  coreWidthPx: 1.0,
  // Shadow (understroke) dash width.
  shadowWidthPx: 2.0,
  // Forward sample step used to smooth direction.
  dirSampleStepSec: 0.1,

  // Non-linear mapping from normalized speed to ramp colors (1 = linear).
  speedRampGamma: 1.0,
  // Core color at low speed.
  coreSlow: [0.86, 0.9, 0.94, 0.2],
  // Core color at high speed.
  coreFast: [0.98, 0.99, 1, 0.25],
  // Shadow color at low speed.
  shadowSlow: [0.52, 0.56, 0.7, 0.1],
  // Shadow color at high speed.
  shadowFast: [0.58, 0.6, 0.7, 0.2],

  // Trail render target scale relative to drawing buffer size.
  trailScale: 0.99,
  // Multiplicative fade applied each frame to previous trail texture.
  trailFade: 0.975,
  // Quantize faded trails to reduce ghost pixels.
  trailQuantize: true,
  // Opacity used when compositing trails back onto the map.
  trailCompositeOpacity: 1.0,
  // Clear trail history when camera/viewport changes.
  clearTrailsOnViewChange: true,
}

export type ForecastRenderSettings = {
  field: FieldRenderSettings
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
  field: FieldRenderSettings
  particles: ParticleSettings
  pressureContours: PressureContourSettings
  units: UnitSettings
}

export type ForecastSettingsActions = {
  updateField: (patch: Partial<FieldRenderSettings>) => void
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
  field: {
    ...DEFAULT_FIELD_RENDER_SETTINGS,
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
