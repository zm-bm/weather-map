import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import {
  type ForecastModelId,
  getLayerModelAvailability,
  resolveCompatibleModelId,
  type ModelLayerAvailabilityIndex,
} from '../forecast-availability'
import type { CycleManifest } from '../manifest'
import {
  FORECAST_LAYER_GROUPS,
  FORECAST_LAYERS_BY_ID,
  getAvailableParticleLayers,
  getDefaultParticleLayer,
  isLayerAvailableInManifest,
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

function resolveFallbackLayer(): LayerId | null {
  return FORECAST_LAYER_GROUPS[0]?.defaultLayer ?? null
}

function safeIsLayerAvailableInManifest(manifest: CycleManifest, layerId: LayerId | null): boolean {
  if (layerId == null) return false
  const layer = FORECAST_LAYERS_BY_ID[layerId]
  if (!layer) return false

  try {
    return isLayerAvailableInManifest(manifest, layer)
  } catch {
    return false
  }
}

export default function ForecastSelectionProvider({
  manifest,
  availabilityIndex = null,
  activeModelId = null,
  onActiveModelChange = () => undefined,
  children,
}: {
  manifest: CycleManifest | null
  availabilityIndex?: ModelLayerAvailabilityIndex | null
  activeModelId?: ForecastModelId | null
  onActiveModelChange?: (modelId: ForecastModelId) => void
  children: ReactNode
}) {
  const [selectedLayerId, setSelectedLayerId] = useState<LayerId | null>(() => resolveFallbackLayer())
  const [selectedParticleLayerId, setSelectedParticleLayerId] = useState<ParticleLayerId | null>(
    () => availableParticleCatalog(manifest).defaultLayer
  )
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('imperial')

  const setSelectedLayer = useCallback((value: LayerId) => {
    setSelectedLayerId(value)
  }, [])

  const setSelectedLayerGroup = useCallback((value: LayerGroupId) => {
    setSelectedLayerId(defaultLayerForGroupId(FORECAST_LAYER_GROUPS, value))
  }, [])

  const setSelectedParticleLayer = useCallback((value: ParticleLayerId) => {
    setSelectedParticleLayerId(value)
  }, [])

  const toggleUnitSystem = useCallback(() => {
    setUnitSystem((current) => current === 'imperial' ? 'metric' : 'imperial')
  }, [])

  useEffect(() => {
    if (activeModelId == null) return
    const resolvedModelId = resolveCompatibleModelId(
      availabilityIndex,
      selectedLayerId,
      activeModelId
    )
    if (resolvedModelId && resolvedModelId !== activeModelId) {
      onActiveModelChange(resolvedModelId)
    }
  }, [
    activeModelId,
    availabilityIndex,
    onActiveModelChange,
    selectedLayerId,
  ])

  const value = useMemo<ForecastSelectionContextValue>(() => {
    if (!manifest) {
      return {
        manifest: null,
        availabilityIndex,
        activeModelId,
        groups: EMPTY_GROUPS,
        layers: null,
        particleLayers: null,
        selectedLayerGroupId: null,
        selectedLayerId: null,
        selectedLayerAvailability: null,
        selectedLayerHasRenderableArtifacts: false,
        selectedParticleLayerId: null,
        unitSystem,
        setSelectedLayerGroup,
        setSelectedLayer,
        setSelectedParticleLayer,
        setUnitSystem,
        toggleUnitSystem,
      }
    }

    const particleCatalog = availableParticleCatalog(manifest)
    const particleLayerIds = Object.keys(particleCatalog.layers ?? {}) as ParticleLayerId[]
    const resolvedSelectedLayerId = selectedLayerId ?? resolveFallbackLayer()
    const resolvedSelectedParticleLayerId =
      selectedParticleLayerId != null
      && particleLayerIds.includes(selectedParticleLayerId)
        ? selectedParticleLayerId
        : particleCatalog.defaultLayer
    const selectedLayerAvailability = getLayerModelAvailability(
      availabilityIndex,
      resolvedSelectedLayerId,
      activeModelId,
    )
    const selectedLayerHasRenderableArtifacts = safeIsLayerAvailableInManifest(manifest, resolvedSelectedLayerId)

    return {
      manifest,
      availabilityIndex,
      activeModelId,
      groups: [...FORECAST_LAYER_GROUPS],
      layers: FORECAST_LAYERS_BY_ID,
      particleLayers: particleCatalog.layers ?? {},
      selectedLayerGroupId: findLayerGroupId(FORECAST_LAYER_GROUPS, resolvedSelectedLayerId),
      selectedLayerId: resolvedSelectedLayerId,
      selectedLayerAvailability,
      selectedLayerHasRenderableArtifacts,
      selectedParticleLayerId: resolvedSelectedParticleLayerId,
      unitSystem,
      setSelectedLayerGroup,
      setSelectedLayer,
      setSelectedParticleLayer,
      setUnitSystem,
      toggleUnitSystem,
    }
  }, [
    activeModelId,
    availabilityIndex,
    manifest,
    selectedLayerId,
    selectedParticleLayerId,
    setSelectedLayer,
    setSelectedLayerGroup,
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
