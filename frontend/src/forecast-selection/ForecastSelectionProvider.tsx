import { useCallback, useMemo, useState, type ReactNode } from 'react'

import type {
  CycleManifest,
  ScalarProductId,
  VectorProductId,
} from '../manifest'
import type { UnitSystem } from '../units'
import {
  ForecastSelectionContext,
  type ForecastSelectionContextValue,
} from './ForecastSelectionContext'

const EMPTY_GROUPS: [] = []

function findScalarGroupId(
  groups: readonly CycleManifest['groups'][number][],
  productId: ScalarProductId | null
): string | null {
  if (productId == null) return null
  return groups.find((group) => group.products.includes(productId))?.id ?? null
}

function defaultScalarForGroupId(
  groups: readonly CycleManifest['groups'][number][],
  groupId: string | null
): ScalarProductId | null {
  if (groupId == null) return null
  return groups.find((group) => group.id === groupId)?.defaultProduct ?? null
}

function resolveFallbackScalar(
  groups: readonly CycleManifest['groups'][number][],
  scalarProducts: CycleManifest['scalarProducts']
): ScalarProductId | null {
  return groups[0]?.defaultProduct ?? scalarProducts[0] ?? null
}

export default function ForecastSelectionProvider({
  manifest,
  children,
}: {
  manifest: CycleManifest | null
  children: ReactNode
}) {
  const [selection, setSelection] = useState<{
    modelId: string | null
    cycle: string | null
    activeScalar: ScalarProductId | null
    activeScalarGroupId: string | null
    activeVector: VectorProductId | null
  }>(() => ({
    modelId: manifest?.model.id ?? null,
    cycle: manifest?.run.cycle ?? null,
    activeScalar: manifest?.scalarProducts[0] ?? null,
    activeScalarGroupId: findScalarGroupId(
      manifest?.groups ?? EMPTY_GROUPS,
      manifest?.scalarProducts[0] ?? null
    ),
    activeVector: manifest?.vectorProducts[0] ?? null,
  }))
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('imperial')

  const setActiveScalar = useCallback((value: ScalarProductId) => {
    setSelection((current) => ({
      modelId: current.modelId,
      cycle: current.cycle,
      activeScalar: value,
      activeScalarGroupId: current.activeScalarGroupId,
      activeVector: current.activeVector,
    }))
  }, [])

  const setActiveVector = useCallback((value: VectorProductId) => {
    setSelection((current) => ({
      modelId: current.modelId,
      cycle: current.cycle,
      activeScalar: current.activeScalar,
      activeScalarGroupId: current.activeScalarGroupId,
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
        groups: EMPTY_GROUPS,
        products: null,
        activeScalar: null,
        activeVector: null,
        unitSystem,
        setActiveScalar,
        setActiveVector,
        setUnitSystem,
        toggleUnitSystem,
      }
    }

    const cycle = manifest.run.cycle
    const modelId = manifest.model.id
    const scalarProducts = manifest.scalarProducts
    const groups = manifest.groups
    const vectorProducts = manifest.vectorProducts
    const sameModel = selection.modelId === modelId
    const sameCycle = selection.cycle === cycle

    const activeScalar =
      ((sameModel && sameCycle) || !sameModel)
      && selection.activeScalar != null
      && scalarProducts.includes(selection.activeScalar)
        ? selection.activeScalar
        : (
            (!sameModel || sameCycle)
              ? defaultScalarForGroupId(groups, selection.activeScalarGroupId)
              : null
          ) ?? resolveFallbackScalar(groups, scalarProducts)
    const activeVector =
      sameCycle
      && selection.activeVector != null
      && vectorProducts.includes(selection.activeVector)
        ? selection.activeVector
        : vectorProducts[0] ?? null

    return {
      manifest,
      groups,
      products: manifest.products,
      activeScalar,
      activeVector,
      unitSystem,
      setActiveScalar: (nextScalar) => {
        setSelection((current) => ({
          modelId,
          cycle,
          activeScalar: nextScalar,
          activeScalarGroupId: findScalarGroupId(groups, nextScalar),
          activeVector:
            current.cycle === cycle
            && current.activeVector != null
            && vectorProducts.includes(current.activeVector)
              ? current.activeVector
              : vectorProducts[0] ?? null,
        }))
      },
      setActiveVector: (nextVector) => {
        setSelection((current) => ({
          modelId,
          cycle,
          activeScalar:
            current.cycle === cycle
            && current.activeScalar != null
            && scalarProducts.includes(current.activeScalar)
              ? current.activeScalar
              : resolveFallbackScalar(groups, scalarProducts),
          activeScalarGroupId:
            current.cycle === cycle
              ? current.activeScalarGroupId
              : findScalarGroupId(groups, resolveFallbackScalar(groups, scalarProducts)),
          activeVector: nextVector,
        }))
      },
      setUnitSystem,
      toggleUnitSystem,
    }
  }, [
    manifest,
    selection.activeScalar,
    selection.activeScalarGroupId,
    selection.activeVector,
    selection.cycle,
    selection.modelId,
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
