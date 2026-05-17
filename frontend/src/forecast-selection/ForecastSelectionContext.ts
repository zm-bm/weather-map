import { createContext, useContext } from 'react'

import type {
  ForecastModelId,
  LayerModelAvailability,
  ModelLayerAvailabilityIndex,
} from '../forecast-availability'
import type { CycleManifest } from '../manifest'
import type {
  LayerGroupId,
  ParticleLayerId,
  ParticleLayerSpec,
  LayerGroupSpec,
  LayerId,
  LayerSpec,
} from '../forecast-catalog'
import type { UnitSystem } from '../units'

type ForecastSelectionContextLoadedValue = {
  manifest: CycleManifest
  availabilityIndex: ModelLayerAvailabilityIndex | null
  activeModelId: ForecastModelId | null
  groups: LayerGroupSpec[]
  layers: Record<string, LayerSpec>
  particleLayers: Record<string, ParticleLayerSpec>
  selectedLayerGroupId: LayerGroupId | null
  selectedLayerId: LayerId | null
  selectedLayerAvailability: LayerModelAvailability | null
  selectedLayerHasRenderableArtifacts: boolean
  selectedParticleLayerId: ParticleLayerId | null
  unitSystem: UnitSystem
  setSelectedLayerGroup: (value: LayerGroupId) => void
  setSelectedLayer: (value: LayerId) => void
  setSelectedParticleLayer: (value: ParticleLayerId) => void
  setUnitSystem: (value: UnitSystem) => void
  toggleUnitSystem: () => void
}

type ForecastSelectionContextUnloadedValue = {
  manifest: null
  availabilityIndex: ModelLayerAvailabilityIndex | null
  activeModelId: ForecastModelId | null
  groups: []
  layers: null
  particleLayers: null
  selectedLayerGroupId: null
  selectedLayerId: null
  selectedLayerAvailability: null
  selectedLayerHasRenderableArtifacts: false
  selectedParticleLayerId: null
  unitSystem: UnitSystem
  setSelectedLayerGroup: (value: LayerGroupId) => void
  setSelectedLayer: (value: LayerId) => void
  setSelectedParticleLayer: (value: ParticleLayerId) => void
  setUnitSystem: (value: UnitSystem) => void
  toggleUnitSystem: () => void
}

export type ForecastSelectionContextValue =
  | ForecastSelectionContextLoadedValue
  | ForecastSelectionContextUnloadedValue

export const ForecastSelectionContext = createContext<ForecastSelectionContextValue | null>(null)

export function useForecastSelectionContext(): ForecastSelectionContextValue {
  const value = useContext(ForecastSelectionContext)
  if (!value) {
    throw new Error('useForecastSelectionContext must be used within a ForecastSelectionProvider')
  }
  return value
}

export function useLoadedForecastSelectionContext(): ForecastSelectionContextLoadedValue {
  const value = useForecastSelectionContext()
  if (value.manifest == null) {
    throw new Error('useLoadedForecastSelectionContext requires a loaded manifest')
  }
  return value
}
