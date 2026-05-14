import type { ForecastFramePlan } from './plan'
import {
  NO_PARTICLES_FRAME_KEY,
} from './keys'
import type {
  ForecastFrameBundle,
  PreviousForecastFrameWindows,
} from './types'

type CommittedForecastFrameBundle = {
  fieldChannelKey: string
  particleChannelKey: string
  bundle: ForecastFrameBundle
}

type ForecastFrameMemory = {
  reusableWindowsFor: (plan: ForecastFramePlan) => PreviousForecastFrameWindows
  shouldClearFieldProbe: (plan: ForecastFramePlan) => boolean
  commit: (plan: ForecastFramePlan, bundle: ForecastFrameBundle) => void
  reset: () => void
}

export function createForecastFrameMemory(): ForecastFrameMemory {
  let committed: CommittedForecastFrameBundle | null = null

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

function particleKey(plan: ForecastFramePlan): string {
  return plan.particles?.key ?? NO_PARTICLES_FRAME_KEY
}
