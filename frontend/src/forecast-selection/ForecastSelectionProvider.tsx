import { useCallback, useMemo, useState, type ReactNode } from 'react'

import type {
  CycleManifest,
  ScalarVariableId,
  VectorVariableId,
} from '../manifest'
import {
  ForecastSelectionContext,
  type ForecastSelectionContextValue,
} from './ForecastSelectionContext'

const EMPTY_SCALAR_VARIABLES: [] = []
const EMPTY_VECTOR_VARIABLES: [] = []
const NO_VARIABLE_META: null = null

export default function ForecastSelectionProvider({
  manifest,
  children,
}: {
  manifest: CycleManifest | null
  children: ReactNode
}) {
  const [selection, setSelection] = useState<{
    cycle: string | null
    activeScalar: ScalarVariableId | null
    activeVector: VectorVariableId | null
  }>(() => ({
    cycle: manifest?.cycle ?? null,
    activeScalar: manifest?.scalarVariables[0] ?? null,
    activeVector: manifest?.vectorVariables[0] ?? null,
  }))
  const [scalarUnitOptionIds, setScalarUnitOptionIds] = useState<Record<string, string>>({})
  const [vectorUnitOptionIds, setVectorUnitOptionIds] = useState<Record<string, string>>({})

  const setActiveScalar = useCallback((value: ScalarVariableId) => {
    setSelection((current) => ({
      cycle: current.cycle,
      activeScalar: value,
      activeVector: current.activeVector,
    }))
  }, [])

  const setActiveVector = useCallback((value: VectorVariableId) => {
    setSelection((current) => ({
      cycle: current.cycle,
      activeScalar: current.activeScalar,
      activeVector: value,
    }))
  }, [])

  const setScalarUnitOptionId = useCallback((variableId: string, optionId: string) => {
    setScalarUnitOptionIds((current) => ({
      ...current,
      [variableId]: optionId,
    }))
  }, [])

  const setVectorUnitOptionId = useCallback((variableId: string, optionId: string) => {
    setVectorUnitOptionIds((current) => ({
      ...current,
      [variableId]: optionId,
    }))
  }, [])

  const getScalarUnitOptionId = useCallback((variableId: string, fallbackOptionId: string) => {
    return scalarUnitOptionIds[variableId] ?? fallbackOptionId
  }, [scalarUnitOptionIds])

  const getVectorUnitOptionId = useCallback((variableId: string, fallbackOptionId: string) => {
    return vectorUnitOptionIds[variableId] ?? fallbackOptionId
  }, [vectorUnitOptionIds])

  const value = useMemo<ForecastSelectionContextValue>(() => {
    if (!manifest) {
      return {
        manifest: null,
        cycle: null,
        scalarVariables: EMPTY_SCALAR_VARIABLES,
        vectorVariables: EMPTY_VECTOR_VARIABLES,
        variableMeta: NO_VARIABLE_META,
        activeScalar: null,
        activeVector: null,
        scalarUnitOptionIds,
        vectorUnitOptionIds,
        setActiveScalar,
        setActiveVector,
        getScalarUnitOptionId,
        getVectorUnitOptionId,
        setScalarUnitOptionId,
        setVectorUnitOptionId,
      }
    }

    const cycle = manifest.cycle
    const scalarVariables = manifest.scalarVariables
    const vectorVariables = manifest.vectorVariables
    const activeScalar =
      selection.cycle === cycle && selection.activeScalar != null
        ? selection.activeScalar
        : scalarVariables[0]
    const activeVector =
      selection.cycle === cycle && selection.activeVector != null
        ? selection.activeVector
        : vectorVariables[0]

    return {
      manifest,
      cycle,
      scalarVariables,
      vectorVariables,
      variableMeta: manifest.variableMeta,
      activeScalar,
      activeVector,
      scalarUnitOptionIds,
      vectorUnitOptionIds,
      setActiveScalar: (nextScalar) => {
        setSelection((current) => ({
          cycle,
          activeScalar: nextScalar,
          activeVector:
            current.cycle === cycle && current.activeVector != null
              ? current.activeVector
              : vectorVariables[0],
        }))
      },
      setActiveVector: (nextVector) => {
        setSelection((current) => ({
          cycle,
          activeScalar:
            current.cycle === cycle && current.activeScalar != null
              ? current.activeScalar
              : scalarVariables[0],
          activeVector: nextVector,
        }))
      },
      getScalarUnitOptionId,
      getVectorUnitOptionId,
      setScalarUnitOptionId,
      setVectorUnitOptionId,
    }
  }, [
    getScalarUnitOptionId,
    getVectorUnitOptionId,
    manifest,
    scalarUnitOptionIds,
    selection.activeScalar,
    selection.activeVector,
    selection.cycle,
    setActiveScalar,
    setActiveVector,
    setScalarUnitOptionId,
    setVectorUnitOptionId,
    vectorUnitOptionIds,
  ])

  return (
    <ForecastSelectionContext.Provider value={value}>
      {children}
    </ForecastSelectionContext.Provider>
  )
}
