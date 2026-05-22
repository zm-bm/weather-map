import type { ForecastDataPlan } from './plan'
import {
  NO_CLOUD_LAYERS_KEY,
  NO_FIELD_KEY,
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
  cloudLayersChannelKey: string
  probeChannelKey: string
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
        field: plan.field != null && committed.fieldChannelKey === fieldKey(plan) ? committed.bundle.field : null,
        cloudLayers: plan.cloudLayers != null &&
          committed.cloudLayersChannelKey === cloudLayersKey(plan)
          ? committed.bundle.cloudLayers
          : null,
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
      return committed != null && committed.probeChannelKey !== probeKey(plan)
    },
    commit(plan, bundle) {
      committed = {
        fieldChannelKey: fieldKey(plan),
        cloudLayersChannelKey: cloudLayersKey(plan),
        probeChannelKey: probeKey(plan),
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

function fieldKey(plan: ForecastDataPlan): string {
  return plan.field?.key ?? NO_FIELD_KEY
}

function cloudLayersKey(plan: ForecastDataPlan): string {
  return plan.cloudLayers?.key ?? NO_CLOUD_LAYERS_KEY
}

function probeKey(plan: ForecastDataPlan): string {
  return plan.field?.key ?? plan.cloudLayers?.key ?? NO_FIELD_KEY
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
