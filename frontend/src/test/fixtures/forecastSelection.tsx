import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { vi } from 'vitest'

import type { CycleManifest } from '../../manifest'
import {
  asParticleLayerId,
  asLayerId,
  FORECAST_LAYER_GROUPS,
  FORECAST_LAYERS_BY_ID,
  getAvailableParticleLayers,
  getDefaultParticleLayer,
  isLayerAvailableInManifest,
  type LayerId,
} from '../../forecast-catalog'
import {
  ForecastSelectionProvider,
  type ForecastSelectionContextValue,
} from '../../forecast-selection'
import type { UnitSystem } from '../../units'


type ForecastSelectionContextOptions = Partial<{
  selectedLayerId: string
  selectedParticleLayerId: string
  unitSystem: UnitSystem
}>

export function createForecastSelectionContextValue(
  manifest: CycleManifest | null,
  options: ForecastSelectionContextOptions = {}
): ForecastSelectionContextValue {
  const shared = {
    availabilityIndex: null,
    unitSystem: options.unitSystem ?? ('imperial' as UnitSystem),
    setSelectedLayerGroup: vi.fn(),
    setSelectedLayer: vi.fn(),
    setSelectedParticleLayer: vi.fn(),
    setUnitSystem: vi.fn(),
    toggleUnitSystem: vi.fn(),
  }
  const particleLayers = manifest == null ? null : getAvailableParticleLayers(manifest)
  const defaultParticleLayer = particleLayers == null ? null : getDefaultParticleLayer(particleLayers)
  const selectedLayerId = options.selectedLayerId
    ? asLayerId(options.selectedLayerId)
    : FORECAST_LAYER_GROUPS[0]?.defaultLayer ?? null
  const selectedLayerHasRenderableArtifacts =
    manifest != null && selectedLayerId != null
      ? safeIsLayerAvailableInManifest(manifest, selectedLayerId)
      : false
  const selectedLayerGroupId = selectedLayerId == null
    ? null
    : FORECAST_LAYER_GROUPS.find((group) => group.layers.includes(selectedLayerId))?.id ?? null

  return (
    manifest == null
      ? {
          manifest: null,
          activeModelId: null,
          groups: [],
          layers: null,
          particleLayers: null,
          selectedLayerGroupId: null,
          selectedLayerId: null,
          selectedLayerAvailability: null,
          selectedLayerHasRenderableArtifacts: false,
          selectedParticleLayerId: null,
          ...shared,
        }
      : {
          manifest,
          activeModelId: manifest.model.id,
          groups: [...FORECAST_LAYER_GROUPS],
          layers: FORECAST_LAYERS_BY_ID,
          particleLayers: particleLayers!,
          selectedLayerGroupId,
          selectedLayerId,
          selectedLayerAvailability: null,
          selectedLayerHasRenderableArtifacts,
          selectedParticleLayerId: options.selectedParticleLayerId
            ? asParticleLayerId(options.selectedParticleLayerId)
            : defaultParticleLayer,
          ...shared,
        }
  ) satisfies ForecastSelectionContextValue
}

export function renderWithForecastSelection(
  ui: ReactNode,
  manifest: CycleManifest
) {
  return render(
    <ForecastSelectionProvider manifest={manifest}>
      {ui}
    </ForecastSelectionProvider>
  )
}

function safeIsLayerAvailableInManifest(manifest: CycleManifest, layerId: LayerId): boolean {
  const layer = FORECAST_LAYERS_BY_ID[layerId]
  if (!layer) return false
  try {
    return isLayerAvailableInManifest(manifest, layer)
  } catch {
    return false
  }
}
