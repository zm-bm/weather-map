import type { Map as MapLibreMap } from 'maplibre-gl'

import type { RenderAdapter } from '../adapter'
import {
  createCustomLayer,
  resolveForecastLayerBeforeId,
} from '../layer'
import { createParticleRuntime } from './engine/runtime'
import { getParticleController } from './controller'
import type { WindVectorInterpolationWindowData } from '../../forecast-products'
import type {
  ParticleRenderSettings,
} from '../../forecast-settings/settings'

export const PARTICLE_LAYER_ID = 'particle-renderer-layer-id'

export const particleAdapter: RenderAdapter = {
  id: 'particles',
  layerId: PARTICLE_LAYER_ID,
  install(map, renderSettings) {
    if (map.getLayer(PARTICLE_LAYER_ID)) return
    map.addLayer(
      createCustomLayer(PARTICLE_LAYER_ID, createParticleRuntime(renderSettings.particles)),
      resolveForecastLayerBeforeId(map),
    )
  },
  uninstall(map) {
    if (!map.getLayer(PARTICLE_LAYER_ID)) return
    map.removeLayer(PARTICLE_LAYER_ID)
  },
  configure(map, renderSettings) {
    applyParticleRenderSettings(map, renderSettings.particles)
  },
  apply(map, data) {
    applyParticleInterpolationWindow(map, data.products.windVectors ?? null)
  },
}

export function applyParticleInterpolationWindow(map: MapLibreMap, frame: WindVectorInterpolationWindowData | null): void {
  const controller = getParticleController(map)
  if (frame == null) {
    controller?.setEnabled(false)
    return
  }

  if (!controller?.isAvailable()) {
    throw new Error('Particle runtime unavailable (WebGL2 required)')
  }

  controller.setEnabled(true)
  controller.applyFrame(frame)
}

export function applyParticleRenderSettings(
  map: MapLibreMap,
  settings: Partial<ParticleRenderSettings>,
): void {
  const controller = getParticleController(map)
  controller?.applySettings(settings)
}
