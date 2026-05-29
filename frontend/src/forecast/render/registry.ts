import type {
  Map as MapLibreMap,
} from 'maplibre-gl'

import type { ForecastWindows } from '@/forecast/frames'
import type {
  ForecastRenderProfile,
  ForecastRenderLayerId,
} from './profile'
import type { ForecastRenderSettings } from '@/forecast/settings/settings'
import type { RenderLayerAdapter } from './maplibre/layerAdapter'
import { rasterAdapter } from './layers/raster/adapter'
import { overlayAdapter } from './layers/overlay/adapter'
import { contourAdapter } from './layers/contour/adapter'
import { particlesAdapter } from './layers/particles/adapter'

const renderAdapters: readonly RenderLayerAdapter[] = [
  rasterAdapter,
  overlayAdapter,
  contourAdapter,
  particlesAdapter,
] as const

const adaptersById = new Map<ForecastRenderLayerId, RenderLayerAdapter>(
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

export function applyWindows(
  map: MapLibreMap,
  profile: ForecastRenderProfile,
  windows: ForecastWindows,
): void {
  for (const adapter of adaptersForProfile(profile)) {
    adapter.apply(map, windows)
  }
}

function adaptersForProfile(profile: ForecastRenderProfile): RenderLayerAdapter[] {
  const seenIds = new Set<ForecastRenderLayerId>()
  const adapters: RenderLayerAdapter[] = []

  for (const rendererId of profile.layerIds) {
    if (seenIds.has(rendererId)) continue
    seenIds.add(rendererId)
    adapters.push(adapterForId(rendererId))
  }

  return adapters
}

function adapterForId(rendererId: ForecastRenderLayerId): RenderLayerAdapter {
  const adapter = adaptersById.get(rendererId)
  if (!adapter) {
    throw new Error(`Unknown forecast renderer ${rendererId}`)
  }
  return adapter
}

function uninstallAdapter(map: MapLibreMap, adapter: RenderLayerAdapter): void {
  adapter.uninstall(map)
}
