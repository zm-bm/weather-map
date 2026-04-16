export type VectorRuntimeOptions = {
  // Reseed all particles whenever a new forecast frame is applied.
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

  // Point sprite size used for each dash draw call.
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
  coreSlow: [number, number, number, number]
  // Core color at high speed.
  coreFast: [number, number, number, number]
  // Shadow color at low speed.
  shadowSlow: [number, number, number, number]
  // Shadow color at high speed.
  shadowFast: [number, number, number, number]

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

export const DEFAULT_VECTOR_RUNTIME_OPTIONS: Readonly<VectorRuntimeOptions> = {
  reseedOnFrameChange: false,
  particleCount: 9000,
  maxAgeSec: 8.5,
  respawnBasePerSec: 0.035,
  respawnSpeedPerMps: 0.007,
  jitterRatio: 0.1,
  flowSpeedScale: 7200,
  flowRefZoom: 5,
  zoomOutRespawnFraction: 0.8,
  zoomOutRespawnMinDelta: 0.05,

  pointSizePx: 20,
  dashMinPx: 10,
  dashMaxPx: 14,
  dashPerMps: 0.035,
  coreWidthPx: 1.5,
  shadowWidthPx: 2.6,
  dirSampleStepSec: 0.24,

  speedRampGamma: 1.1,
  coreSlow: [0.86, 0.9, 0.94, 0.24],
  coreFast: [0.98, 0.99, 1, 0.5],
  shadowSlow: [0.12, 0.16, 0.3, 0.13],
  shadowFast: [0.08, 0.1, 0.2, 0.2],

  trailScale: 0.95,
  trailFade: 0.975,
  trailQuantize: true,
  trailCompositeOpacity: 0.92,
  clearTrailsOnViewChange: true,
}

export const vectorRuntimeOptions: VectorRuntimeOptions = {
  ...DEFAULT_VECTOR_RUNTIME_OPTIONS,
}
