import type { ForecastDataPlan } from './plan'
import {
  NO_PARTICLES_KEY,
  NO_PRECIP_TYPE_OVERLAY_KEY,
} from './keys'
import type {
  ForecastRenderData,
  PreviousForecastInterpolationWindows,
} from './types'

type CommittedForecastRenderData = {
  fieldChannelKey: string
  precipTypeOverlayChannelKey: string
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
        precipTypeOverlay: committed.precipTypeOverlayChannelKey === precipTypeOverlayKey(plan)
          ? committed.bundle.precipTypeOverlay
          : null,
        particles: committed.particleChannelKey === particleKey(plan) ? committed.bundle.particles : null,
      }
    },
    shouldClearFieldProbe(plan) {
      return committed != null && committed.fieldChannelKey !== plan.field.key
    },
    commit(plan, bundle) {
      committed = {
        fieldChannelKey: plan.field.key,
        precipTypeOverlayChannelKey: precipTypeOverlayKey(plan),
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

function particleKey(plan: ForecastDataPlan): string {
  return plan.particles?.key ?? NO_PARTICLES_KEY
}
