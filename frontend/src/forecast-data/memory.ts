import type { ForecastDataPlan } from './plan'
import {
  NO_PARTICLES_KEY,
  NO_PRECIP_TYPE_OVERLAY_KEY,
  NO_PRESSURE_CONTOURS_KEY,
} from './keys'
import type {
  ForecastRenderData,
  PreviousForecastInterpolationWindows,
} from './types'

type CommittedForecastRenderData = {
  fieldChannelKey: string
  precipTypeOverlayChannelKey: string
  pressureContourChannelKey: string
  particleChannelKey: string
  bundle: ForecastRenderData
}

type ForecastDataMemory = {
  reusableWindowsFor: (plan: ForecastDataPlan) => PreviousForecastInterpolationWindows
  shouldClearFieldProbe: (plan: ForecastDataPlan) => boolean
  commit: (plan: ForecastDataPlan, bundle: ForecastRenderData) => void
  reset: () => void
}

export function createForecastDataMemory(): ForecastDataMemory {
  let committed: CommittedForecastRenderData | null = null

  return {
    reusableWindowsFor(plan) {
      if (committed == null) return {}

      return {
        field: committed.fieldChannelKey === plan.field.key ? committed.bundle.field : null,
        precipTypeOverlay: plan.precipTypeOverlay != null &&
          committed.precipTypeOverlayChannelKey === precipTypeOverlayKey(plan)
          ? committed.bundle.precipTypeOverlay
          : null,
        pressureContours: plan.pressureContours != null &&
          committed.pressureContourChannelKey === pressureContourKey(plan)
          ? committed.bundle.pressureContours
          : null,
        particles: plan.particles != null && committed.particleChannelKey === particleKey(plan)
          ? committed.bundle.particles
          : null,
      }
    },
    shouldClearFieldProbe(plan) {
      return committed != null && committed.fieldChannelKey !== plan.field.key
    },
    commit(plan, bundle) {
      committed = {
        fieldChannelKey: plan.field.key,
        precipTypeOverlayChannelKey: precipTypeOverlayKey(plan),
        pressureContourChannelKey: pressureContourKey(plan),
        particleChannelKey: particleKey(plan),
        bundle,
      }
    },
    reset() {
      committed = null
    },
  }
}

function precipTypeOverlayKey(plan: ForecastDataPlan): string {
  return plan.precipTypeOverlay?.key ?? NO_PRECIP_TYPE_OVERLAY_KEY
}

function pressureContourKey(plan: ForecastDataPlan): string {
  return plan.pressureContours?.key ?? NO_PRESSURE_CONTOURS_KEY
}

function particleKey(plan: ForecastDataPlan): string {
  return plan.particles?.key ?? NO_PARTICLES_KEY
}
