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
  // Reseed all particles whenever new particle data is applied.
  reseedOnFrameChange: boolean
  // Number of simulated particles.
  particleCount: number
  // Maximum particle lifetime before forced respawn.
  maxAgeSec: number
  // Baseline random respawn chance per second.
  respawnBasePerSec: number
  // Extra respawn chance per m/s of local flow speed.
  respawnSpeedPerMps: number
  // Perpendicular stochastic wobble as a fraction of local speed.
  jitterRatio: number
  // World-space advection scaling.
  flowSpeedScale: number
  // Reference zoom used to normalize flowSpeedScale.
  flowRefZoom: number
  // Fraction of particles to forcibly respawn after a zoom-out gesture.
  zoomOutRespawnFraction: number
  // Minimum net zoom-out delta required to trigger zoomOutRespawnFraction.
  zoomOutRespawnMinDelta: number

  // Point size used for each dash draw call.
  pointSizePx: number
  // Minimum dash length in pixels.
  dashMinPx: number
  // Maximum dash length in pixels.
  dashMaxPx: number
  // Additional dash length per m/s.
  dashPerMps: number
  // Core (foreground) dash stroke width.
  coreWidthPx: number
  // Shadow (understroke) dash width.
  shadowWidthPx: number
  // Forward sample step used to smooth direction.
  dirSampleStepSec: number

  // Non-linear mapping from normalized speed to ramp colors (1 = linear).
  speedRampGamma: number
  // Core color at low speed.
  coreSlow: ParticleColor
  // Core color at high speed.
  coreFast: ParticleColor
  // Shadow color at low speed.
  shadowSlow: ParticleColor
  // Shadow color at high speed.
  shadowFast: ParticleColor

  // Trail render target scale relative to drawing buffer size.
  trailScale: number
  // Multiplicative fade applied each frame to previous trail texture.
  trailFade: number
  // Quantize faded trails to reduce ghost pixels.
  trailQuantize: boolean
  // Opacity used when compositing trails back onto the map.
  trailCompositeOpacity: number
  // Clear trail history when camera/viewport changes.
  clearTrailsOnViewChange: boolean
}

export const DEFAULT_PARTICLE_RENDER_SETTINGS: Readonly<ParticleRenderSettings> = {
  reseedOnFrameChange: false,
  particleCount: 5000,
  maxAgeSec: 8.5,
  respawnBasePerSec: 0.035,
  respawnSpeedPerMps: 0.007,
  jitterRatio: 0.1,
  flowSpeedScale: 7200,
  flowRefZoom: 5,
  zoomOutRespawnFraction: 0.8,
  zoomOutRespawnMinDelta: 0.05,

  pointSizePx: 20,
  dashMinPx: 8,
  dashMaxPx: 12,
  dashPerMps: 0.035,
  coreWidthPx: 1.6,
  shadowWidthPx: 2.8,
  dirSampleStepSec: 0.24,

  speedRampGamma: 1.2,
  coreSlow: [0.86, 0.9, 0.94, 0.2],
  coreFast: [0.98, 0.99, 1, 0.3],
  shadowSlow: [0.52, 0.56, 0.7, 0.06],
  shadowFast: [0.58, 0.6, 0.7, 0.12],

  trailScale: 0.90,
  trailFade: 0.925,
  trailQuantize: true,
  trailCompositeOpacity: 1.0,
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

export type ForecastSettings = {
  field: FieldRenderSettings
  particles: ParticleSettings
  pressureContours: PressureContourSettings
}

export type ForecastSettingsActions = {
  updateField: (patch: Partial<FieldRenderSettings>) => void
  updateParticles: (patch: Partial<ParticleSettings>) => void
  updatePressureContours: (patch: Partial<PressureContourSettings>) => void
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
} as const satisfies ForecastSettings
