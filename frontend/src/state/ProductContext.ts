import { createContext, useContext } from 'react'

import type {
  CycleManifest,
  ScalarVariableId,
  VectorVariableId,
} from '../map/manifest'

type ProductContextLoadedValue = {
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

type ProductContextUnloadedValue = {
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

export type ProductContextValue = ProductContextLoadedValue | ProductContextUnloadedValue

export const ProductContext = createContext<ProductContextValue | null>(null)

export function useProductContext(): ProductContextValue {
  const value = useContext(ProductContext)
  if (!value) {
    throw new Error('useProductContext must be used within a ProductProvider')
  }
  return value
}

export function useLoadedProductContext(): ProductContextLoadedValue {
  const value = useProductContext()
  if (value.manifest == null) {
    throw new Error('useLoadedProductContext requires a loaded manifest')
  }
  return value
}
