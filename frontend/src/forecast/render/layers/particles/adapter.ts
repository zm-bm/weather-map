import type { Map as MapLibreMap } from 'maplibre-gl'

import {
  createRenderLayerAdapter,
  createRenderControllerRegistry,
} from '../../maplibre/layerAdapter'
import { createParticlesRuntime } from './runtime'
import type { ParticlesController } from './runtime'
import type { ParticlesWindow } from '@/forecast/frames'
import type {
  ParticleRenderSettings,
} from '@/forecast/settings/settings'

export const PARTICLES_LAYER_ID = 'forecast-particles-layer'

const particlesControllerRegistry = createRenderControllerRegistry<ParticlesController>()

export const particlesAdapter = createRenderLayerAdapter({
  id: 'particles',
  layerId: PARTICLES_LAYER_ID,
  createRuntime: (renderSettings) => createParticlesRuntime(
    particlesControllerRegistry,
    renderSettings.particles
  ),
  configure: (map, renderSettings) => applyParticlesRenderSettings(map, renderSettings.particles),
  apply: (map, windows) => applyParticlesWindow(map, windows.particles ?? null),
})

function applyParticlesWindow(map: MapLibreMap, frame: ParticlesWindow | null): void {
  const controller = particlesControllerRegistry.get(map)
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

function applyParticlesRenderSettings(
  map: MapLibreMap,
  settings: Partial<ParticleRenderSettings>,
): void {
  const controller = particlesControllerRegistry.get(map)
  controller?.applySettings(settings)
}
