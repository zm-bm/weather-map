import { createContext, useContext } from 'react'

import type { CycleManifest } from '../manifest'
import type {
  ParticleLayerId,
  ParticleLayerSpec,
  LayerGroupSpec,
  LayerId,
  LayerSpec,
} from '../forecast-catalog'
import type { UnitSystem } from '../units'

type ForecastSelectionContextLoadedValue = {
  manifest: CycleManifest
  groups: LayerGroupSpec[]
  layers: Record<string, LayerSpec>
  particleLayers: Record<string, ParticleLayerSpec>
  selectedLayerId: LayerId | null
  selectedParticleLayerId: ParticleLayerId | null
  unitSystem: UnitSystem
  setSelectedLayer: (value: LayerId) => void
  setSelectedParticleLayer: (value: ParticleLayerId) => void
  setUnitSystem: (value: UnitSystem) => void
  toggleUnitSystem: () => void
}

type ForecastSelectionContextUnloadedValue = {
  manifest: null
  groups: []
  layers: null
  particleLayers: null
  selectedLayerId: null
  selectedParticleLayerId: null
  unitSystem: UnitSystem
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
