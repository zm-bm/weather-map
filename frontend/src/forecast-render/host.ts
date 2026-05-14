import type {
  Map as MapLibreMap,
} from 'maplibre-gl'

import type { ForecastFrameBundle } from '../forecast-frame'
import type { ForecastRenderer } from './types'
import { applyFieldFrame, fieldRenderer } from './field'
import { applyParticleFrame, particleRenderer } from './particles'

export const forecastRenderers: readonly ForecastRenderer[] = [
  fieldRenderer,
  particleRenderer,
] as const

export function installForecastRenderers(map: MapLibreMap): void {
  for (const renderer of forecastRenderers) {
    renderer.install(map)
  }
}

export function applyForecastFrames(map: MapLibreMap, frames: ForecastFrameBundle): void {
  applyFieldFrame(map, frames.field)
  applyParticleFrame(map, frames.particles)
}
