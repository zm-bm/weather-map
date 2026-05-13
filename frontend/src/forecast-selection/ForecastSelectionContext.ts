import { createContext, useContext } from 'react'

import type {
  CycleManifest,
  VectorProductId,
} from '../manifest'
import type {
  ScalarLayerGroupSpec,
  ScalarLayerId,
  ScalarLayerSpec,
} from '../forecast-catalog'
import type { UnitSystem } from '../units'

type ForecastSelectionContextLoadedValue = {
  manifest: CycleManifest
  groups: ScalarLayerGroupSpec[]
  scalarLayers: Record<string, ScalarLayerSpec>
  products: CycleManifest['products']
  activeScalar: ScalarLayerId | null
  activeVector: VectorProductId | null
  unitSystem: UnitSystem
  setActiveScalar: (value: ScalarLayerId) => void
  setActiveVector: (value: VectorProductId) => void
  setUnitSystem: (value: UnitSystem) => void
  toggleUnitSystem: () => void
}

type ForecastSelectionContextUnloadedValue = {
  manifest: null
  groups: []
  scalarLayers: null
  products: null
  activeScalar: null
  activeVector: null
  unitSystem: UnitSystem
  setActiveScalar: (value: ScalarLayerId) => void
  setActiveVector: (value: VectorProductId) => void
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
