import { useCallback, useMemo, useState, type ReactNode } from 'react'

import type {
  CycleManifest,
  ScalarVariableId,
  VectorVariableId,
} from '../manifest'
import type { UnitSystem } from '../units'
import {
  ForecastSelectionContext,
  type ForecastSelectionContextValue,
} from './ForecastSelectionContext'

const EMPTY_SCALAR_VARIABLES: [] = []
const EMPTY_SCALAR_VARIABLE_GROUPS: [] = []
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
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('imperial')

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

  const toggleUnitSystem = useCallback(() => {
    setUnitSystem((current) => current === 'imperial' ? 'metric' : 'imperial')
  }, [])

  const value = useMemo<ForecastSelectionContextValue>(() => {
    if (!manifest) {
      return {
        manifest: null,
        cycle: null,
        scalarVariables: EMPTY_SCALAR_VARIABLES,
        scalarVariableGroups: EMPTY_SCALAR_VARIABLE_GROUPS,
        vectorVariables: EMPTY_VECTOR_VARIABLES,
        variableMeta: NO_VARIABLE_META,
        activeScalar: null,
        activeVector: null,
        unitSystem,
        setActiveScalar,
        setActiveVector,
        setUnitSystem,
        toggleUnitSystem,
      }
    }

    const cycle = manifest.cycle
    const scalarVariables = manifest.scalarVariables
    const scalarVariableGroups = manifest.scalarVariableGroups
    const vectorVariables = manifest.vectorVariables
    const activeScalar =
      selection.cycle === cycle
      && selection.activeScalar != null
      && scalarVariables.includes(selection.activeScalar)
        ? selection.activeScalar
        : scalarVariables[0]
    const activeVector =
      selection.cycle === cycle
      && selection.activeVector != null
      && vectorVariables.includes(selection.activeVector)
        ? selection.activeVector
        : vectorVariables[0]

    return {
      manifest,
      cycle,
      scalarVariables,
      scalarVariableGroups,
      vectorVariables,
      variableMeta: manifest.variableMeta,
      activeScalar,
      activeVector,
      unitSystem,
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
            current.cycle === cycle
            && current.activeScalar != null
            && scalarVariables.includes(current.activeScalar)
              ? current.activeScalar
              : scalarVariables[0],
          activeVector: nextVector,
        }))
      },
      setUnitSystem,
      toggleUnitSystem,
    }
  }, [
    manifest,
    selection.activeScalar,
    selection.activeVector,
    selection.cycle,
    setActiveScalar,
    setActiveVector,
    toggleUnitSystem,
    unitSystem,
  ])

  return (
    <ForecastSelectionContext.Provider value={value}>
      {children}
    </ForecastSelectionContext.Provider>
  )
}
