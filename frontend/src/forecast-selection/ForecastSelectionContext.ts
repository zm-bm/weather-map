import { createContext, useContext } from 'react'

import type {
  CycleManifest,
  ScalarVariableId,
  VectorVariableId,
} from '../manifest'
import type { UnitSystem } from '../units'

type ForecastSelectionContextLoadedValue = {
  manifest: CycleManifest
  cycle: string
  scalarVariables: CycleManifest['scalarVariables']
  vectorVariables: CycleManifest['vectorVariables']
  variableMeta: CycleManifest['variableMeta']
  activeScalar: ScalarVariableId
  activeVector: VectorVariableId
  unitSystem: UnitSystem
  setActiveScalar: (value: ScalarVariableId) => void
  setActiveVector: (value: VectorVariableId) => void
  setUnitSystem: (value: UnitSystem) => void
  toggleUnitSystem: () => void
}

type ForecastSelectionContextUnloadedValue = {
  manifest: null
  cycle: string | null
  scalarVariables: []
  vectorVariables: []
  variableMeta: CycleManifest['variableMeta'] | null
  activeScalar: null
  activeVector: null
  unitSystem: UnitSystem
  setActiveScalar: (value: ScalarVariableId) => void
  setActiveVector: (value: VectorVariableId) => void
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
