import { useCallback, useEffect, useMemo, useState } from 'react'

import { isAbortError, normalizeError } from '@/core/abort'
import { fetchManifest } from './fetch'
import {
  modelOptionsFromManifest,
  resolveActiveForecastRun,
} from './resolution'
import type {
  ActiveForecastRun,
  ForecastModelId,
  ForecastModelOption,
  Manifest,
} from './schema'

export type ForecastManifestData = {
  activeRun: ActiveForecastRun
  modelOptions: readonly ForecastModelOption[]
  setActiveModel: (modelId: ForecastModelId) => void
}

export type ForecastManifestState = {
  phase: 'loading' | 'ready' | 'error'
  data: ForecastManifestData | null
  error: Error | null
  retry: () => void
}

type ManifestRequest =
  | { phase: 'loading' }
  | { phase: 'ready'; manifest: Manifest }
  | { phase: 'error'; error: Error }

export function useForecastManifest(): ForecastManifestState {
  const [preferredModelId, setPreferredModelId] = useState<ForecastModelId | null>(null)
  const { request, retry } = useManifestRequest()

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

    const { manifest } = request
    const modelOptions = modelOptionsFromManifest(manifest)
    if (modelOptions.length === 0) {
      return startupError('Forecast manifest did not list any models.', retry)
    }

    const activeRun = resolveActiveForecastRun(manifest, preferredModelId)
    if (activeRun == null) {
      return startupError('Forecast manifest did not include latest render data for any model.', retry)
    }

    return {
      phase: 'ready',
      data: {
        activeRun,
        modelOptions,
        setActiveModel,
      },
      error: null,
      retry,
    }
  }, [preferredModelId, request, retry, setActiveModel])
}

function useManifestRequest(): {
  request: ManifestRequest
  retry: () => void
} {
  const [request, setRequest] = useState<ManifestRequest>({
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

      const manifest = await fetchManifest({ signal: ac.signal })
      if (ac.signal.aborted) return
      setRequest({
        phase: 'ready',
        manifest,
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

function startupError(error: unknown, retry: () => void): ForecastManifestState {
  return {
    phase: 'error',
    data: null,
    error: typeof error === 'string' ? new Error(error) : normalizeError(error),
    retry,
  }
}
