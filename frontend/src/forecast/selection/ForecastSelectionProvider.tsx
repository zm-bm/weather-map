import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import {
  type ActiveForecastRun,
  type ForecastModelId,
  type ForecastModelOption,
  getActiveRunLayerAvailability,
  isLayerAvailableForModel,
  resolveCompatibleActiveForecastRun,
} from '@/forecast/manifest'
import {
  FORECAST_LAYER_GROUPS,
  FORECAST_LAYERS_BY_ID,
  getAvailableParticleLayers,
  getDefaultParticleLayer,
  type ParticleLayerId,
  type LayerGroupSpec,
  type LayerGroupId,
  type LayerId,
} from '@/forecast/catalog'
import {
  ForecastSelectionContext,
  type ForecastSelectionContextValue,
} from './ForecastSelectionContext'

const EMPTY_GROUPS: [] = []
const DEFAULT_LAYER_ID = FORECAST_LAYER_GROUPS[0]?.defaultLayer ?? null
const noopActiveModelChange = () => undefined

function availableParticleCatalog(activeRun: ActiveForecastRun | null) {
  if (!activeRun) {
    return { layers: null, defaultLayer: null }
  }
  const layers = getAvailableParticleLayers(activeRun)
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

export default function ForecastSelectionProvider({
  activeRun,
  modelOptions = [],
  onActiveModelChange = noopActiveModelChange,
  children,
}: {
  activeRun: ActiveForecastRun | null
  modelOptions?: readonly ForecastModelOption[]
  onActiveModelChange?: (modelId: ForecastModelId) => void
  children: ReactNode
}) {
  const [selectedLayerId, setSelectedLayerId] = useState<LayerId | null>(DEFAULT_LAYER_ID)
  const [selectedParticleLayerId, setSelectedParticleLayerId] = useState<ParticleLayerId | null>(
    () => availableParticleCatalog(activeRun).defaultLayer
  )

  const setActiveModel = useCallback((value: ForecastModelId) => {
    if (
      activeRun != null &&
      selectedLayerId != null &&
      !isLayerAvailableForModel(activeRun.manifest, selectedLayerId, value)
    ) {
      return
    }

    onActiveModelChange(value)
  }, [
    activeRun,
    onActiveModelChange,
    selectedLayerId,
  ])

  const setSelectedLayerGroup = useCallback((value: LayerGroupId) => {
    setSelectedLayerId(defaultLayerForGroupId(FORECAST_LAYER_GROUPS, value))
  }, [])

  useEffect(() => {
    if (activeRun == null) return
    const resolvedRun = resolveCompatibleActiveForecastRun(
      activeRun,
      selectedLayerId
    )
    if (resolvedRun && resolvedRun.modelId !== activeRun.modelId) {
      onActiveModelChange(resolvedRun.modelId)
    }
  }, [
    activeRun,
    onActiveModelChange,
    selectedLayerId,
  ])

  const value = useMemo<ForecastSelectionContextValue>(() => {
    const baseValue = {
      modelOptions,
      setActiveModel,
      setSelectedLayerGroup,
      setSelectedLayer: setSelectedLayerId,
      setSelectedParticleLayer: setSelectedParticleLayerId,
    }

    if (!activeRun) {
      return {
        ...baseValue,
        activeRun: null,
        groups: EMPTY_GROUPS,
        layers: null,
        particleLayers: null,
        selectedLayerGroupId: null,
        selectedLayerId: null,
        selectedLayerAvailability: null,
        selectedLayerIsRenderable: false,
        selectedParticleLayerId: null,
      }
    }

    const particleCatalog = availableParticleCatalog(activeRun)
    const particleLayerIds = Object.keys(particleCatalog.layers ?? {}) as ParticleLayerId[]
    const resolvedSelectedLayerId = selectedLayerId ?? DEFAULT_LAYER_ID
    const resolvedSelectedParticleLayerId =
      selectedParticleLayerId != null
      && particleLayerIds.includes(selectedParticleLayerId)
        ? selectedParticleLayerId
        : particleCatalog.defaultLayer
    const selectedLayerAvailability = getActiveRunLayerAvailability(activeRun, resolvedSelectedLayerId)
    const selectedLayerIsRenderable = selectedLayerAvailability?.state === 'available'

    return {
      ...baseValue,
      activeRun,
      groups: FORECAST_LAYER_GROUPS,
      layers: FORECAST_LAYERS_BY_ID,
      particleLayers: particleCatalog.layers ?? {},
      selectedLayerGroupId: findLayerGroupId(FORECAST_LAYER_GROUPS, resolvedSelectedLayerId),
      selectedLayerId: resolvedSelectedLayerId,
      selectedLayerAvailability,
      selectedLayerIsRenderable,
      selectedParticleLayerId: resolvedSelectedParticleLayerId,
    }
  }, [
    activeRun,
    modelOptions,
    selectedLayerId,
    selectedParticleLayerId,
    setActiveModel,
    setSelectedLayerGroup,
  ])

  return (
    <ForecastSelectionContext.Provider value={value}>
      {children}
    </ForecastSelectionContext.Provider>
  )
}
