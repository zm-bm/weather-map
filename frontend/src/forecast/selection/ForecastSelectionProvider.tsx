import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'

import {
  type ForecastDatasetId,
  type ForecastDatasetOption,
  type Manifest,
  isLayerAvailableForDataset,
  resolveActiveForecastRun,
  resolveCompatibleActiveForecastRun,
} from '@/forecast/manifest'
import {
  getAvailableParticleLayer,
  getDefaultAvailableParticleLayerId,
} from '@/forecast/catalog'
import {
  ForecastSelectionContext,
  type ForecastSelectionContextValue,
} from './ForecastSelectionContext'
import {
  DEFAULT_SELECTED_LAYER_ID,
  SELECTED_LAYER_QUERY_PARAM,
  normalizeSelectedLayerId,
  resolvePersistedSelectedLayerId,
  saveStoredSelectedLayerId,
  selectedLayerIdFromSearchParams,
} from './selectedLayerPersistence'
import {
  loadStoredActiveDatasetId,
  normalizeActiveDatasetId,
  saveStoredActiveDatasetId,
} from './activeDatasetPersistence'

const DEFAULT_LAYER_ID = DEFAULT_SELECTED_LAYER_ID

export default function ForecastSelectionProvider({
  manifest,
  datasetOptions = [],
  children,
}: {
  manifest: Manifest | null
  datasetOptions?: readonly ForecastDatasetOption[]
  children: ReactNode
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [fallbackLayerId, setFallbackLayerId] = useState<string>(
    () => resolvePersistedSelectedLayerId(searchParams)
  )
  const [preferredDatasetId, setPreferredDatasetId] = useState<ForecastDatasetId | null>(
    () => resolveInitialActiveDatasetId(
      manifest,
      resolvePersistedSelectedLayerId(searchParams)
    )
  )
  const selectedLayerId = selectedLayerIdFromSearchParams(searchParams) ?? fallbackLayerId
  const activeRun = useMemo(
    () => resolveSelectedActiveRun(manifest, preferredDatasetId, selectedLayerId),
    [manifest, preferredDatasetId, selectedLayerId]
  )
  const [selectedParticleLayerId, setSelectedParticleLayerId] = useState<string | null>(
    () => getDefaultAvailableParticleLayerId(activeRun)
  )

  const updateSelectedLayerParam = useCallback((layerId: string) => {
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set(SELECTED_LAYER_QUERY_PARAM, layerId)
    setSearchParams(nextParams, { replace: true })
  }, [searchParams, setSearchParams])

  const setSelectedLayer = useCallback((value: string) => {
    const nextLayerId = normalizeSelectedLayerId(value) ?? DEFAULT_LAYER_ID
    setFallbackLayerId(nextLayerId)
    saveStoredSelectedLayerId(nextLayerId)
    const nextDatasetId = resolveSelectedActiveRun(
      manifest,
      preferredDatasetId,
      nextLayerId
    )?.datasetId
    if (nextDatasetId != null && nextDatasetId !== preferredDatasetId) {
      setPreferredDatasetId(nextDatasetId)
      saveStoredActiveDatasetId(nextDatasetId)
    }
    updateSelectedLayerParam(nextLayerId)
  }, [
    manifest,
    preferredDatasetId,
    updateSelectedLayerParam,
  ])

  useEffect(() => {
    saveStoredSelectedLayerId(selectedLayerId)

    if (searchParams.get(SELECTED_LAYER_QUERY_PARAM) === selectedLayerId) return
    updateSelectedLayerParam(selectedLayerId)
  }, [
    searchParams,
    selectedLayerId,
    updateSelectedLayerParam,
  ])

  const setActiveDataset = useCallback((value: ForecastDatasetId) => {
    if (normalizeActiveDatasetId(manifest, value) == null) return
    if (
      selectedLayerId != null &&
      !isLayerAvailableForDataset(manifest, selectedLayerId, value)
    ) {
      return
    }

    setPreferredDatasetId(value)
    saveStoredActiveDatasetId(value)
  }, [
    manifest,
    selectedLayerId,
  ])

  useEffect(() => {
    if (activeRun == null) return
    saveStoredActiveDatasetId(activeRun.datasetId)
  }, [
    activeRun,
  ])

  const value = useMemo<ForecastSelectionContextValue>(() => {
    const baseValue = {
      datasetOptions,
      setActiveDataset,
      setSelectedLayer,
      setSelectedParticleLayer: setSelectedParticleLayerId,
    }

    if (!activeRun) {
      return {
        ...baseValue,
        activeRun: null,
        activeDatasetId: null,
        selectedLayerId: null,
        selectedParticleLayerId: null,
      }
    }

    const resolvedSelectedParticleLayerId =
      selectedParticleLayerId != null
      && getAvailableParticleLayer(activeRun, selectedParticleLayerId) != null
        ? selectedParticleLayerId
        : getDefaultAvailableParticleLayerId(activeRun)

    return {
      ...baseValue,
      activeRun,
      activeDatasetId: activeRun.datasetId,
      selectedLayerId,
      selectedParticleLayerId: resolvedSelectedParticleLayerId,
    }
  }, [
    activeRun,
    datasetOptions,
    selectedLayerId,
    selectedParticleLayerId,
    setActiveDataset,
    setSelectedLayer,
  ])

  return (
    <ForecastSelectionContext.Provider value={value}>
      {children}
    </ForecastSelectionContext.Provider>
  )
}

function resolveInitialActiveDatasetId(
  manifest: Manifest | null,
  selectedLayerId: string | null
): ForecastDatasetId | null {
  if (manifest == null) return loadStoredActiveDatasetId()
  return resolveSelectedActiveRun(
    manifest,
    normalizeActiveDatasetId(manifest, loadStoredActiveDatasetId()),
    selectedLayerId
  )?.datasetId ?? null
}

function resolveSelectedActiveRun(
  manifest: Manifest | null,
  preferredDatasetId: ForecastDatasetId | null,
  selectedLayerId: string | null
) {
  const preferredActiveRun = resolveActiveForecastRun(manifest, preferredDatasetId)
  return resolveCompatibleActiveForecastRun(preferredActiveRun, selectedLayerId)
    ?? preferredActiveRun
}
