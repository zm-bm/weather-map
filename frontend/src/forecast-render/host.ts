import type {
  Map as MapLibreMap,
} from 'maplibre-gl'

import type { ForecastRenderData } from '../forecast-data'
import type {
  ForecastRenderProfile,
  ForecastRenderer,
  ForecastRendererId,
} from './types'
import { fieldRenderer } from './field'
import { fieldOverlayRenderer } from './field-overlay'
import { contourOverlayRenderer } from './contour-overlay'
import { particleRenderer } from './particles'

const forecastRenderers: readonly ForecastRenderer[] = [
  fieldRenderer,
  fieldOverlayRenderer,
  contourOverlayRenderer,
  particleRenderer,
] as const
const forecastRenderersById = new Map<ForecastRendererId, ForecastRenderer>(
  forecastRenderers.map((renderer) => [renderer.id, renderer])
)

export function reconcileForecastRenderers(
  map: MapLibreMap,
  profile: ForecastRenderProfile,
): void {
  const activeRenderers = renderersForProfile(profile)
  const activeRendererIds = new Set(activeRenderers.map((renderer) => renderer.id))

  for (const renderer of [...forecastRenderers].reverse()) {
    if (activeRendererIds.has(renderer.id)) continue
    uninstallRenderer(map, renderer)
  }

  for (const renderer of activeRenderers) {
    renderer.install(map)
  }
}

export function applyForecastRenderProfileData(
  map: MapLibreMap,
  profile: ForecastRenderProfile,
  data: ForecastRenderData,
): void {
  for (const renderer of renderersForProfile(profile)) {
    renderer.apply(map, data)
  }
}

function renderersForProfile(profile: ForecastRenderProfile): ForecastRenderer[] {
  const rendererIds = new Set<ForecastRendererId>()
  const renderers: ForecastRenderer[] = []

  for (const rendererId of profile.rendererIds) {
    if (rendererIds.has(rendererId)) continue
    rendererIds.add(rendererId)
    renderers.push(rendererForId(rendererId))
  }

  return renderers
}

function rendererForId(rendererId: ForecastRendererId): ForecastRenderer {
  const renderer = forecastRenderersById.get(rendererId)
  if (!renderer) {
    throw new Error(`Unknown forecast renderer ${rendererId}`)
  }
  return renderer
}

function uninstallRenderer(map: MapLibreMap, renderer: ForecastRenderer): void {
  if (!map.getLayer(renderer.layerId)) return
  if (renderer.uninstall) {
    renderer.uninstall(map)
    return
  }
  map.removeLayer(renderer.layerId)
}
