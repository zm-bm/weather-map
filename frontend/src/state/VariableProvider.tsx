import { useCallback, useMemo, useState, type ReactNode } from 'react'

import type {
  CycleManifest,
  ScalarVariableId,
  VectorVariableId,
} from '../map/manifest'
import { VariableContext, type VariableContextValue } from './VariableContext'

const EMPTY_SCALAR_VARIABLES: [] = []
const EMPTY_VECTOR_VARIABLES: [] = []
const NO_VARIABLE_META: null = null

export default function VariableProvider({
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

  const value = useMemo<VariableContextValue>(() => {
    if (!manifest) {
      return {
        manifest: null,
        cycle: null,
        scalarVariables: EMPTY_SCALAR_VARIABLES,
        vectorVariables: EMPTY_VECTOR_VARIABLES,
        variableMeta: NO_VARIABLE_META,
        activeScalar: null,
        activeVector: null,
        setActiveScalar,
        setActiveVector,
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
    }
  }, [manifest, selection.activeScalar, selection.activeVector, selection.cycle, setActiveScalar, setActiveVector])

  return (
    <VariableContext.Provider value={value}>
      {children}
    </VariableContext.Provider>
  )
}
