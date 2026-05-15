import { useCallback, useMemo, useState, type ReactNode } from 'react'

import type { CycleManifest } from '../manifest'
import {
  getAvailableGroups,
  getAvailableLayers,
  getAvailableParticleLayers,
  getDefaultParticleLayer,
  type ParticleLayerId,
  type LayerGroupSpec,
  type LayerGroupId,
  type LayerId,
} from '../forecast-catalog'
import type { UnitSystem } from '../units'
import {
  ForecastSelectionContext,
  type ForecastSelectionContextValue,
} from './ForecastSelectionContext'

const EMPTY_GROUPS: [] = []

function availableLayerCatalog(manifest: CycleManifest | null) {
  if (!manifest) return { groups: EMPTY_GROUPS, layers: null }
  const layers = getAvailableLayers(manifest)
  return { groups: getAvailableGroups(layers), layers }
}

function availableParticleCatalog(manifest: CycleManifest | null) {
  if (!manifest) return { layers: null, defaultLayer: null }
  const layers = getAvailableParticleLayers(manifest)
  return { layers, defaultLayer: getDefaultParticleLayer(layers) }
}

function findLayerGroupId(
  groups: readonly LayerGroupSpec[],
  layerId: LayerId | null
): LayerGroupId | null {
  if (layerId == null) return null
  return groups.find((group) => group.layers.includes(layerId))?.id ?? null
}

function defaultLayerForGroupId(
  groups: readonly LayerGroupSpec[],
  groupId: LayerGroupId | null
): LayerId | null {
  if (groupId == null) return null
  return groups.find((group) => group.id === groupId)?.defaultLayer ?? null
}

function resolveFallbackLayer(
  groups: readonly LayerGroupSpec[],
  layers: readonly LayerId[]
): LayerId | null {
  return groups[0]?.defaultLayer ?? layers[0] ?? null
}

export default function ForecastSelectionProvider({
  manifest,
  children,
}: {
  manifest: CycleManifest | null
  children: ReactNode
}) {
  const initialLayerCatalog = availableLayerCatalog(manifest)
  const initialLayers = Object.keys(initialLayerCatalog.layers ?? {}) as LayerId[]
  const initialLayerGroups = initialLayerCatalog.groups
  const initialParticleCatalog = availableParticleCatalog(manifest)
  const initialSelectedLayerId = resolveFallbackLayer(initialLayerGroups, initialLayers)
  const [selection, setSelection] = useState<{
    modelId: string | null
    cycle: string | null
    selectedLayerId: LayerId | null
    selectedLayerGroupId: LayerGroupId | null
    selectedParticleLayerId: ParticleLayerId | null
  }>(() => ({
    modelId: manifest?.model.id ?? null,
    cycle: manifest?.run.cycle ?? null,
    selectedLayerId: initialSelectedLayerId,
    selectedLayerGroupId: findLayerGroupId(
      initialLayerGroups,
      initialSelectedLayerId
    ),
    selectedParticleLayerId: initialParticleCatalog.defaultLayer,
  }))
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('imperial')

  const setSelectedLayer = useCallback((value: LayerId) => {
    setSelection((current) => ({
      modelId: current.modelId,
      cycle: current.cycle,
      selectedLayerId: value,
      selectedLayerGroupId: current.selectedLayerGroupId,
      selectedParticleLayerId: current.selectedParticleLayerId,
    }))
  }, [])

  const setSelectedParticleLayer = useCallback((value: ParticleLayerId) => {
    setSelection((current) => ({
      modelId: current.modelId,
      cycle: current.cycle,
      selectedLayerId: current.selectedLayerId,
      selectedLayerGroupId: current.selectedLayerGroupId,
      selectedParticleLayerId: value,
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
        layers: null,
        particleLayers: null,
        selectedLayerId: null,
        selectedParticleLayerId: null,
        unitSystem,
        setSelectedLayer,
        setSelectedParticleLayer,
        setUnitSystem,
        toggleUnitSystem,
      }
    }

    const cycle = manifest.run.cycle
    const modelId = manifest.model.id
    const layerCatalog = availableLayerCatalog(manifest)
    const layers = Object.keys(layerCatalog.layers ?? {}) as LayerId[]
    const groups = layerCatalog.groups
    const particleCatalog = availableParticleCatalog(manifest)
    const particleLayers = Object.keys(particleCatalog.layers ?? {}) as ParticleLayerId[]
    const sameModel = selection.modelId === modelId
    const sameCycle = selection.cycle === cycle

    const selectedLayerId =
      ((sameModel && sameCycle) || !sameModel)
      && selection.selectedLayerId != null
      && layers.includes(selection.selectedLayerId)
        ? selection.selectedLayerId
        : (
            (!sameModel || sameCycle)
              ? defaultLayerForGroupId(groups, selection.selectedLayerGroupId)
              : null
          ) ?? resolveFallbackLayer(groups, layers)
    const selectedParticleLayerId =
      sameCycle
      && selection.selectedParticleLayerId != null
      && particleLayers.includes(selection.selectedParticleLayerId)
        ? selection.selectedParticleLayerId
        : particleCatalog.defaultLayer

    return {
      manifest,
      groups,
      layers: layerCatalog.layers ?? {},
      particleLayers: particleCatalog.layers ?? {},
      selectedLayerId,
      selectedParticleLayerId,
      unitSystem,
      setSelectedLayer: (nextLayer) => {
        setSelection((current) => ({
          modelId,
          cycle,
          selectedLayerId: nextLayer,
          selectedLayerGroupId: findLayerGroupId(groups, nextLayer),
          selectedParticleLayerId:
            current.cycle === cycle
            && current.selectedParticleLayerId != null
            && particleLayers.includes(current.selectedParticleLayerId)
              ? current.selectedParticleLayerId
              : particleCatalog.defaultLayer,
        }))
      },
      setSelectedParticleLayer: (nextParticleLayer) => {
        setSelection((current) => ({
          modelId,
          cycle,
          selectedLayerId:
            current.cycle === cycle
            && current.selectedLayerId != null
            && layers.includes(current.selectedLayerId)
              ? current.selectedLayerId
              : resolveFallbackLayer(groups, layers),
          selectedLayerGroupId:
            current.cycle === cycle
              ? current.selectedLayerGroupId
              : findLayerGroupId(groups, resolveFallbackLayer(groups, layers)),
          selectedParticleLayerId: nextParticleLayer,
        }))
      },
      setUnitSystem,
      toggleUnitSystem,
    }
  }, [
    manifest,
    selection.cycle,
    selection.modelId,
    selection.selectedLayerGroupId,
    selection.selectedLayerId,
    selection.selectedParticleLayerId,
    setSelectedLayer,
    setSelectedParticleLayer,
    toggleUnitSystem,
    unitSystem,
  ])

  return (
    <ForecastSelectionContext.Provider value={value}>
      {children}
    </ForecastSelectionContext.Provider>
  )
}
