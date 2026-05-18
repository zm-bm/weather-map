import { createContext, useContext } from 'react'

import type {
  ActiveForecastRun,
  ForecastModelId,
  ForecastModelOption,
  LayerModelAvailability,
} from '../forecast-manifest'
import type {
  LayerGroupId,
  ParticleLayerId,
  ParticleLayerSpec,
  LayerGroupSpec,
  LayerId,
  LayerSpec,
} from '../forecast-catalog'
import type { UnitSystem } from '../units'

type ForecastSelectionBaseValue = {
  activeRun: ActiveForecastRun | null
  modelOptions: readonly ForecastModelOption[]
  unitSystem: UnitSystem
  setActiveModel: (value: ForecastModelId) => void
  setSelectedLayerGroup: (value: LayerGroupId) => void
  setSelectedLayer: (value: LayerId) => void
  setSelectedParticleLayer: (value: ParticleLayerId) => void
  setUnitSystem: (value: UnitSystem) => void
  toggleUnitSystem: () => void
}

type ForecastSelectionContextLoadedValue = ForecastSelectionBaseValue & {
  activeRun: ActiveForecastRun
  groups: readonly LayerGroupSpec[]
  layers: Record<string, LayerSpec>
  particleLayers: Record<string, ParticleLayerSpec>
  selectedLayerGroupId: LayerGroupId | null
  selectedLayerId: LayerId | null
  selectedLayerAvailability: LayerModelAvailability | null
  selectedLayerIsRenderable: boolean
  selectedParticleLayerId: ParticleLayerId | null
}

type ForecastSelectionContextUnloadedValue = ForecastSelectionBaseValue & {
  activeRun: null
  groups: []
  layers: null
  particleLayers: null
  selectedLayerGroupId: null
  selectedLayerId: null
  selectedLayerAvailability: null
  selectedLayerIsRenderable: false
  selectedParticleLayerId: null
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
  if (value.activeRun == null) {
    throw new Error('useLoadedForecastSelectionContext requires a loaded forecast run')
  }
  return value
}
