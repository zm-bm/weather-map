import { useCallback, useMemo, useState, type ReactNode } from 'react'

import type {
  CycleManifest,
  ProductId,
  VectorProductId,
} from '../manifest'
import {
  buildAvailableScalarCatalog,
  type ScalarLayerGroupSpec,
  type ScalarLayerId,
} from '../forecast-catalog'
import type { UnitSystem } from '../units'
import {
  ForecastSelectionContext,
  type ForecastSelectionContextValue,
} from './ForecastSelectionContext'

const EMPTY_GROUPS: [] = []
const EMPTY_PRODUCTS: [] = []

function productsForKind(manifest: CycleManifest | null, kind: string): ProductId[] {
  return manifest?.productsByKind[kind] ?? EMPTY_PRODUCTS
}

function availableScalarCatalog(manifest: CycleManifest | null) {
  return manifest ? buildAvailableScalarCatalog(manifest) : { groups: EMPTY_GROUPS, layers: null }
}

function findScalarGroupId(
  groups: readonly ScalarLayerGroupSpec[],
  layerId: ScalarLayerId | null
): string | null {
  if (layerId == null) return null
  return groups.find((group) => group.layers.includes(layerId))?.id ?? null
}

function defaultScalarForGroupId(
  groups: readonly ScalarLayerGroupSpec[],
  groupId: string | null
): ScalarLayerId | null {
  if (groupId == null) return null
  return groups.find((group) => group.id === groupId)?.defaultLayer ?? null
}

function resolveFallbackScalar(
  groups: readonly ScalarLayerGroupSpec[],
  scalarLayers: readonly ScalarLayerId[]
): ScalarLayerId | null {
  return groups[0]?.defaultLayer ?? scalarLayers[0] ?? null
}

export default function ForecastSelectionProvider({
  manifest,
  children,
}: {
  manifest: CycleManifest | null
  children: ReactNode
}) {
  const initialScalarCatalog = availableScalarCatalog(manifest)
  const initialScalarLayers = Object.keys(initialScalarCatalog.layers ?? {}) as ScalarLayerId[]
  const initialVectorProducts = productsForKind(manifest, 'vector') as VectorProductId[]
  const initialScalarGroups = initialScalarCatalog.groups
  const initialActiveScalar = resolveFallbackScalar(initialScalarGroups, initialScalarLayers)
  const [selection, setSelection] = useState<{
    modelId: string | null
    cycle: string | null
    activeScalar: ScalarLayerId | null
    activeScalarGroupId: string | null
    activeVector: VectorProductId | null
  }>(() => ({
    modelId: manifest?.model.id ?? null,
    cycle: manifest?.run.cycle ?? null,
    activeScalar: initialActiveScalar,
    activeScalarGroupId: findScalarGroupId(
      initialScalarGroups,
      initialActiveScalar
    ),
    activeVector: initialVectorProducts[0] ?? null,
  }))
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('imperial')

  const setActiveScalar = useCallback((value: ScalarLayerId) => {
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
        scalarLayers: null,
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
    const scalarCatalog = buildAvailableScalarCatalog(manifest)
    const scalarLayers = Object.keys(scalarCatalog.layers) as ScalarLayerId[]
    const groups = scalarCatalog.groups
    const vectorProducts = productsForKind(manifest, 'vector') as VectorProductId[]
    const sameModel = selection.modelId === modelId
    const sameCycle = selection.cycle === cycle

    const activeScalar =
      ((sameModel && sameCycle) || !sameModel)
      && selection.activeScalar != null
      && scalarLayers.includes(selection.activeScalar)
        ? selection.activeScalar
        : (
            (!sameModel || sameCycle)
              ? defaultScalarForGroupId(groups, selection.activeScalarGroupId)
              : null
          ) ?? resolveFallbackScalar(groups, scalarLayers)
    const activeVector =
      sameCycle
      && selection.activeVector != null
      && vectorProducts.includes(selection.activeVector)
        ? selection.activeVector
        : vectorProducts[0] ?? null

    return {
      manifest,
      groups,
      scalarLayers: scalarCatalog.layers,
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
            && scalarLayers.includes(current.activeScalar)
              ? current.activeScalar
              : resolveFallbackScalar(groups, scalarLayers),
          activeScalarGroupId:
            current.cycle === cycle
              ? current.activeScalarGroupId
              : findScalarGroupId(groups, resolveFallbackScalar(groups, scalarLayers)),
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
