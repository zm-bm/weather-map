import { clamp, smoothstep, wrap } from '@/core/math'

import {
  PRESSURE_CONTOUR_HALO_ALPHA,
  PRESSURE_CONTOUR_HALO_HALF_WIDTH_PX,
  PRESSURE_CONTOUR_INTERVAL_HPA,
  PRESSURE_CONTOUR_MAIN_ALPHA,
  PRESSURE_CONTOUR_MAIN_HALF_WIDTH_PX,
  PRESSURE_CONTOUR_SMOOTHING_KERNEL_WEIGHTS,
} from './constants'

export function pressureContourPhaseDistanceHpa(pressureHpa: number): number {
  if (!Number.isFinite(pressureHpa)) return Number.NaN
  const phase = wrap(pressureHpa, PRESSURE_CONTOUR_INTERVAL_HPA)
  return Math.min(phase, PRESSURE_CONTOUR_INTERVAL_HPA - phase)
}

export function smoothPressureHpa3x3(valuesHpa: readonly number[]): number {
  const centerValue = valuesHpa[4] ?? Number.NaN
  if (!Number.isFinite(centerValue)) return Number.NaN

  let weightedPressureHpa = 0
  let totalWeight = 0
  PRESSURE_CONTOUR_SMOOTHING_KERNEL_WEIGHTS.forEach((weight, index) => {
    const value = valuesHpa[index] ?? Number.NaN
    if (!Number.isFinite(value)) return
    weightedPressureHpa += value * weight
    totalWeight += weight
  })

  return totalWeight > 0 ? weightedPressureHpa / totalWeight : Number.NaN
}

export function pressureContourPhaseBandAlpha(args: {
  distanceHpa: number
  pressureDerivativeHpa: number
  halfWidthPx: number
}): number {
  if (
    !Number.isFinite(args.distanceHpa) ||
    !Number.isFinite(args.pressureDerivativeHpa) ||
    !Number.isFinite(args.halfWidthPx) ||
    args.pressureDerivativeHpa <= 1e-5
  ) {
    return 0
  }

  const derivative = Math.max(args.pressureDerivativeHpa, 1e-4)
  const inner = derivative * Math.max(0, args.halfWidthPx)
  const outer = derivative * (Math.max(0, args.halfWidthPx) + 1)
  return 1 - smoothstep(inner, outer, args.distanceHpa)
}

export function pressureContourPhaseBandWeights(args: {
  pressureHpa: number
  pressureDerivativeHpa: number
}): {
  mainAlpha: number
  haloAlpha: number
} {
  const distanceHpa = pressureContourPhaseDistanceHpa(args.pressureHpa)
  const mainAlpha = pressureContourPhaseBandAlpha({
    distanceHpa,
    pressureDerivativeHpa: args.pressureDerivativeHpa,
    halfWidthPx: PRESSURE_CONTOUR_MAIN_HALF_WIDTH_PX,
  }) * PRESSURE_CONTOUR_MAIN_ALPHA
  const haloAlpha = pressureContourPhaseBandAlpha({
    distanceHpa,
    pressureDerivativeHpa: args.pressureDerivativeHpa,
    halfWidthPx: PRESSURE_CONTOUR_HALO_HALF_WIDTH_PX,
  }) * PRESSURE_CONTOUR_HALO_ALPHA

  return { mainAlpha, haloAlpha }
}

export function interpolatePressureHpa(args: {
  lowerHpa: number
  upperHpa: number
  mix: number
}): number {
  const lowerFinite = Number.isFinite(args.lowerHpa)
  const upperFinite = Number.isFinite(args.upperHpa)
  if (!lowerFinite && !upperFinite) return Number.NaN
  if (!lowerFinite) return args.upperHpa
  if (!upperFinite) return args.lowerHpa
  return args.lowerHpa + ((args.upperHpa - args.lowerHpa) * clamp(args.mix, 0, 1))
}
