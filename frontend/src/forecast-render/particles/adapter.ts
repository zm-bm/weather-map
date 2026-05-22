import type { Map as MapLibreMap } from 'maplibre-gl'

import type { ForecastRenderer } from '../types'
import { resolveForecastLayerBeforeId } from '../placement'
import { createParticleRuntime } from './engine/runtime'
import { getParticleController } from './controller'
import type { ParticleInterpolationWindowData } from '../../forecast-data'
import type {
  ParticleRenderSettings,
  ForecastRenderSettings,
} from '../../forecast-settings/settings'

export const PARTICLE_RENDERER_LAYER_ID = 'particle-renderer-layer-id'

export const particleRenderer: ForecastRenderer = {
  id: 'particles',
  layerId: PARTICLE_RENDERER_LAYER_ID,
  install(map, renderSettings) {
    if (map.getLayer(PARTICLE_RENDERER_LAYER_ID)) return
    map.addLayer(createParticleCustomLayer(renderSettings.particles), resolveForecastLayerBeforeId(map))
  },
  uninstall(map) {
    if (!map.getLayer(PARTICLE_RENDERER_LAYER_ID)) return
    map.removeLayer(PARTICLE_RENDERER_LAYER_ID)
  },
  configure(map, renderSettings) {
    applyParticleRenderSettings(map, renderSettings.particles)
  },
  apply(map, data) {
    applyParticleInterpolationWindow(map, data.particles)
  },
}

export function applyParticleInterpolationWindow(map: MapLibreMap, frame: ParticleInterpolationWindowData | null): void {
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

function createParticleCustomLayer(settings: ForecastRenderSettings['particles']) {
  const runtime = createParticleRuntime(settings)
  return {
    id: PARTICLE_RENDERER_LAYER_ID,
    type: 'custom' as const,
    renderingMode: '2d' as const,
    onAdd: (map: Parameters<typeof runtime.onAdd>[0], gl: Parameters<typeof runtime.onAdd>[1]) => runtime.onAdd(map, gl),
    render: (gl: Parameters<typeof runtime.render>[0], input: Parameters<typeof runtime.render>[1]) => runtime.render(gl, input),
    onRemove: (map: Parameters<typeof runtime.onRemove>[0], gl: Parameters<typeof runtime.onRemove>[1]) => runtime.onRemove(map, gl),
  }
}
