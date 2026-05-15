import type {
  Map as MapLibreMap,
} from 'maplibre-gl'

import type { ForecastRenderData } from '../forecast-data'
import type { ForecastRenderer } from './types'
import { applyFieldInterpolationWindow, fieldRenderer } from './field'
import { applyParticleInterpolationWindow, particleRenderer } from './particles'

export const forecastRenderers: readonly ForecastRenderer[] = [
  fieldRenderer,
  particleRenderer,
] as const

export function installForecastRenderers(map: MapLibreMap): void {
  for (const renderer of forecastRenderers) {
    renderer.install(map)
  }
}

export function applyForecastRenderData(map: MapLibreMap, frames: ForecastRenderData): void {
  applyFieldInterpolationWindow(map, frames.field)
  applyParticleInterpolationWindow(map, frames.particles)
}
