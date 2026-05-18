import { useCallback, useEffect, useMemo, useState } from 'react'

import { isAbortError, normalizeError } from '../abort'
import {
  fetchAvailabilityIndex,
  type ForecastModelId,
  type ForecastModelOption,
  type ModelLayerAvailabilityIndex,
  modelOptionsFromAvailabilityIndex,
} from '../forecast-availability'
import { createCycleManifestFromAvailability } from './availabilityManifest'
import type { ForecastBootstrapState } from './types'

type AvailabilityIndexRequest =
  | { phase: 'loading' }
  | { phase: 'ready'; availabilityIndex: ModelLayerAvailabilityIndex }
  | { phase: 'error'; error: Error }

export function useForecastBootstrap(): ForecastBootstrapState {
  const [preferredModelId, setPreferredModelId] = useState<ForecastModelId | null>(null)
  const { request, retry } = useAvailabilityIndexRequest()

  const setActiveModel = useCallback((modelId: ForecastModelId) => {
    setPreferredModelId(modelId)
  }, [])

  return useMemo(() => {
    if (request.phase === 'loading') {
      return { phase: 'loading', data: null, error: null, retry }
    }
    if (request.phase === 'error') {
      return { phase: 'error', data: null, error: request.error, retry }
    }

    const { availabilityIndex } = request
    const modelOptions = modelOptionsFromAvailabilityIndex(availabilityIndex)
    if (modelOptions.length === 0) {
      return startupError('Forecast availability did not list any models.', retry)
    }

    const activeModelId = resolveActiveModelId(availabilityIndex, preferredModelId, modelOptions)
    if (activeModelId == null) {
      return startupError('Forecast availability did not include latest render data for any model.', retry)
    }

    try {
      return {
        phase: 'ready',
        data: {
          manifest: createCycleManifestFromAvailability({ availabilityIndex, modelId: activeModelId }),
          availabilityIndex,
          activeModelId,
          modelOptions,
          setActiveModel,
        },
        error: null,
        retry,
      }
    } catch (err) {
      return startupError(err, retry)
    }
  }, [preferredModelId, request, retry, setActiveModel])
}

function useAvailabilityIndexRequest(): {
  request: AvailabilityIndexRequest
  retry: () => void
} {
  const [request, setRequest] = useState<AvailabilityIndexRequest>({
    phase: 'loading',
  })
  const [retryToken, setRetryToken] = useState(0)

  const retry = useCallback(() => {
    setRetryToken((token) => token + 1)
  }, [])

  useEffect(() => {
    const ac = new AbortController()

    const run = async () => {
      setRequest({ phase: 'loading' })

      const availabilityIndex = await fetchAvailabilityIndex({ signal: ac.signal })
      if (ac.signal.aborted) return
      setRequest({
        phase: 'ready',
        availabilityIndex,
      })
    }

    run().catch((err) => {
      if (isAbortError(err)) return
      if (ac.signal.aborted) return
      setRequest({
        phase: 'error',
        error: normalizeError(err),
      })
    })

    return () => ac.abort()
  }, [retryToken])

  return {
    request,
    retry,
  }
}

function startupError(error: unknown, retry: () => void): ForecastBootstrapState {
  return {
    phase: 'error',
    data: null,
    error: typeof error === 'string' ? new Error(error) : normalizeError(error),
    retry,
  }
}

function resolveActiveModelId(
  availabilityIndex: ModelLayerAvailabilityIndex,
  preferredModelId: ForecastModelId | null,
  modelOptions: readonly ForecastModelOption[]
): ForecastModelId | null {
  if (preferredModelId && availabilityIndex.models[preferredModelId]) {
    return preferredModelId
  }

  return modelOptions.find((model) => availabilityIndex.models[model.id]?.latest)?.id ?? null
}
