import { createContext, useContext } from 'react'

import type {
  CycleManifest,
  ScalarVariableId,
  VectorVariableId,
} from '../manifest'

type ForecastSelectionContextLoadedValue = {
  manifest: CycleManifest
  cycle: string
  scalarVariables: CycleManifest['scalarVariables']
  vectorVariables: CycleManifest['vectorVariables']
  variableMeta: CycleManifest['variableMeta']
  activeScalar: ScalarVariableId
  activeVector: VectorVariableId
  scalarUnitOptionIds: Record<string, string>
  vectorUnitOptionIds: Record<string, string>
  setActiveScalar: (value: ScalarVariableId) => void
  setActiveVector: (value: VectorVariableId) => void
  getScalarUnitOptionId: (variableId: string, fallbackOptionId: string) => string
  getVectorUnitOptionId: (variableId: string, fallbackOptionId: string) => string
  setScalarUnitOptionId: (variableId: string, optionId: string) => void
  setVectorUnitOptionId: (variableId: string, optionId: string) => void
}

type ForecastSelectionContextUnloadedValue = {
  manifest: null
  cycle: string | null
  scalarVariables: []
  vectorVariables: []
  variableMeta: CycleManifest['variableMeta'] | null
  activeScalar: null
  activeVector: null
  scalarUnitOptionIds: Record<string, string>
  vectorUnitOptionIds: Record<string, string>
  setActiveScalar: (value: ScalarVariableId) => void
  setActiveVector: (value: VectorVariableId) => void
  getScalarUnitOptionId: (variableId: string, fallbackOptionId: string) => string
  getVectorUnitOptionId: (variableId: string, fallbackOptionId: string) => string
  setScalarUnitOptionId: (variableId: string, optionId: string) => void
  setVectorUnitOptionId: (variableId: string, optionId: string) => void
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
