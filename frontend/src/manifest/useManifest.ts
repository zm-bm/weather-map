import { useCallback, useEffect, useState } from 'react'

import { DEFAULT_FORECAST_MODEL_ID, type ForecastModelId } from '../forecast-models'
import { fetchCurrentManifest } from './fetch'
import type { CycleManifest } from './schema'
import { isAbortError, normalizeError } from '../abort'

export type UseManifestResult = {
  manifest: CycleManifest | null
  loading: boolean
  error: Error | null
  retry: () => void
}

type ManifestRequestState = {
  modelId: ForecastModelId
  manifest: CycleManifest | null
  loading: boolean
  error: Error | null
}

export function useManifest(modelId: ForecastModelId = DEFAULT_FORECAST_MODEL_ID): UseManifestResult {
  const [requestState, setRequestState] = useState<ManifestRequestState>(() => ({
    modelId,
    manifest: null,
    loading: true,
    error: null,
  }))
  const [retryToken, setRetryToken] = useState(0)

  const retry = useCallback(() => {
    setRetryToken((token) => token + 1)
  }, [])

  useEffect(() => {
    const ac = new AbortController()

    const run = async () => {
      setRequestState({
        modelId,
        manifest: null,
        loading: true,
        error: null,
      })

      const manifest = await fetchCurrentManifest({ modelId, signal: ac.signal })
      if (ac.signal.aborted) return
      setRequestState({
        modelId,
        manifest,
        loading: false,
        error: null,
      })
    }

    run().catch((err) => {
      if (isAbortError(err)) return
      if (ac.signal.aborted) return
      setRequestState({
        modelId,
        manifest: null,
        loading: false,
        error: normalizeError(err),
      })
    })

    return () => ac.abort()
  }, [modelId, retryToken])

  const isCurrentModel = requestState.modelId === modelId
  const manifest = isCurrentModel ? requestState.manifest : null
  const loading = !isCurrentModel || requestState.loading
  const error = isCurrentModel ? requestState.error : null

  const normalizedError =
    error ??
    (!loading && !manifest
      ? new Error('No forecast manifest was returned.')
      : null)

  return { manifest, loading, error: normalizedError, retry }
}
