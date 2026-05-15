import type { ForecastDataPlan } from './plan'
import {
  NO_PARTICLES_KEY,
} from './keys'
import type {
  ForecastRenderData,
  PreviousForecastInterpolationWindows,
} from './types'

type CommittedForecastRenderData = {
  fieldChannelKey: string
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
        particles: committed.particleChannelKey === particleKey(plan) ? committed.bundle.particles : null,
      }
    },
    shouldClearFieldProbe(plan) {
      return committed != null && committed.fieldChannelKey !== plan.field.key
    },
    commit(plan, bundle) {
      committed = {
        fieldChannelKey: plan.field.key,
        particleChannelKey: particleKey(plan),
        bundle,
      }
    },
    reset() {
      committed = null
    },
  }
}

function particleKey(plan: ForecastDataPlan): string {
  return plan.particles?.key ?? NO_PARTICLES_KEY
}
