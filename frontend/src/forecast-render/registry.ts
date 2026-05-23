import type {
  Map as MapLibreMap,
} from 'maplibre-gl'

import type { ForecastRenderData } from '../forecast-data'
import type {
  ForecastRenderProfile,
  ForecastRendererId,
} from './types'
import type { ForecastRenderSettings } from '../forecast-settings/settings'
import type { RenderAdapter } from './adapter'
import { fieldAdapter } from './field/adapter'
import { cloudLayersAdapter } from './cloud-layers/adapter'
import { fieldOverlayAdapter } from './field-overlay/adapter'
import { contourOverlayAdapter } from './contour-overlay/adapter'
import { particleAdapter } from './particles/adapter'

const renderAdapters: readonly RenderAdapter[] = [
  fieldAdapter,
  cloudLayersAdapter,
  fieldOverlayAdapter,
  contourOverlayAdapter,
  particleAdapter,
] as const

const adaptersById = new Map<ForecastRendererId, RenderAdapter>(
  renderAdapters.map((adapter) => [adapter.id, adapter])
)

export function reconcileProfile(
  map: MapLibreMap,
  profile: ForecastRenderProfile,
  renderSettings: ForecastRenderSettings,
): void {
  const activeAdapters = adaptersForProfile(profile)
  const activeIds = new Set(activeAdapters.map((adapter) => adapter.id))

  for (const adapter of [...renderAdapters].reverse()) {
    if (activeIds.has(adapter.id)) continue
    uninstallAdapter(map, adapter)
  }

  for (const adapter of activeAdapters) {
    adapter.install(map, renderSettings)
  }
}

export function configureProfile(
  map: MapLibreMap,
  profile: ForecastRenderProfile,
  renderSettings: ForecastRenderSettings,
): void {
  for (const adapter of adaptersForProfile(profile)) {
    adapter.configure?.(map, renderSettings)
  }
}

export function applyData(
  map: MapLibreMap,
  profile: ForecastRenderProfile,
  data: ForecastRenderData,
): void {
  for (const adapter of adaptersForProfile(profile)) {
    adapter.apply(map, data)
  }
}

function adaptersForProfile(profile: ForecastRenderProfile): RenderAdapter[] {
  const seenIds = new Set<ForecastRendererId>()
  const adapters: RenderAdapter[] = []

  for (const rendererId of profile.rendererIds) {
    if (seenIds.has(rendererId)) continue
    seenIds.add(rendererId)
    adapters.push(adapterForId(rendererId))
  }

  return adapters
}

function adapterForId(rendererId: ForecastRendererId): RenderAdapter {
  const adapter = adaptersById.get(rendererId)
  if (!adapter) {
    throw new Error(`Unknown forecast renderer ${rendererId}`)
  }
  return adapter
}

function uninstallAdapter(map: MapLibreMap, adapter: RenderAdapter): void {
  if (!map.getLayer(adapter.layerId)) return
  if (adapter.uninstall) {
    adapter.uninstall(map)
    return
  }
  map.removeLayer(adapter.layerId)
}
