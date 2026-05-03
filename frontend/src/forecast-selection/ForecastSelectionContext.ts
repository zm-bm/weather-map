import { createContext, useContext } from 'react'

import type {
  CycleManifest,
  ScalarProductId,
  VectorProductId,
} from '../manifest'
import type { UnitSystem } from '../units'

type ForecastSelectionContextLoadedValue = {
  manifest: CycleManifest
  groups: CycleManifest['groups']
  products: CycleManifest['products']
  activeScalar: ScalarProductId | null
  activeVector: VectorProductId | null
  unitSystem: UnitSystem
  setActiveScalar: (value: ScalarProductId) => void
  setActiveVector: (value: VectorProductId) => void
  setUnitSystem: (value: UnitSystem) => void
  toggleUnitSystem: () => void
}

type ForecastSelectionContextUnloadedValue = {
  manifest: null
  groups: []
  products: null
  activeScalar: null
  activeVector: null
  unitSystem: UnitSystem
  setActiveScalar: (value: ScalarProductId) => void
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
