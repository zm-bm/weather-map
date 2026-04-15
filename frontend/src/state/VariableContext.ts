import { createContext, useContext } from 'react'

import type {
  CycleManifest,
  ScalarVariableId,
  VectorVariableId,
} from '../map/manifest'

type VariableContextLoadedValue = {
  manifest: CycleManifest
  cycle: string
  scalarVariables: CycleManifest['scalarVariables']
  vectorVariables: CycleManifest['vectorVariables']
  variableMeta: CycleManifest['variableMeta']
  activeScalar: ScalarVariableId
  activeVector: VectorVariableId
  setActiveScalar: (value: ScalarVariableId) => void
  setActiveVector: (value: VectorVariableId) => void
}

type VariableContextUnloadedValue = {
  manifest: null
  cycle: string | null
  scalarVariables: []
  vectorVariables: []
  variableMeta: CycleManifest['variableMeta'] | null
  activeScalar: null
  activeVector: null
  setActiveScalar: (value: ScalarVariableId) => void
  setActiveVector: (value: VectorVariableId) => void
}

export type VariableContextValue = VariableContextLoadedValue | VariableContextUnloadedValue

export const VariableContext = createContext<VariableContextValue | null>(null)

export function useVariableContext(): VariableContextValue {
  const value = useContext(VariableContext)
  if (!value) {
    throw new Error('useVariableContext must be used within a VariableProvider')
  }
  return value
}

export function useLoadedVariableContext(): VariableContextLoadedValue {
  const value = useVariableContext()
  if (value.manifest == null) {
    throw new Error('useLoadedVariableContext requires a loaded manifest')
  }
  return value
}
