import { useCallback, useEffect, useState } from 'react'

import { fetchCurrentManifest } from './fetch'
import type { CycleManifest } from './schema'
import { isAbortError, normalizeError } from '../abort'

export type UseManifestResult = {
  manifest: CycleManifest | null
  loading: boolean
  error: Error | null
  retry: () => void
}

export type UseManifestOptions = {
  enabled?: boolean
}

type ManifestRequestState = {
  manifestPath: string | null
  manifest: CycleManifest | null
  loading: boolean
  error: Error | null
}

export function useManifest(
  manifestPath: string | null,
  opts: UseManifestOptions = {}
): UseManifestResult {
  const enabled = (opts.enabled ?? true) && manifestPath != null
  const [requestState, setRequestState] = useState<ManifestRequestState>(() => ({
    manifestPath,
    manifest: null,
    loading: enabled,
    error: null,
  }))
  const [retryToken, setRetryToken] = useState(0)

  const retry = useCallback(() => {
    setRetryToken((token) => token + 1)
  }, [])

  useEffect(() => {
    if (!enabled || manifestPath == null) return

    const ac = new AbortController()

    const run = async () => {
      setRequestState({
        manifestPath,
        manifest: null,
        loading: true,
        error: null,
      })

      const manifest = await fetchCurrentManifest({ manifestPath, signal: ac.signal })
      if (ac.signal.aborted) return
      setRequestState({
        manifestPath,
        manifest,
        loading: false,
        error: null,
      })
    }

    run().catch((err) => {
      if (isAbortError(err)) return
      if (ac.signal.aborted) return
      setRequestState({
        manifestPath,
        manifest: null,
        loading: false,
        error: normalizeError(err),
      })
    })

    return () => ac.abort()
  }, [enabled, manifestPath, retryToken])

  if (!enabled) {
    return {
      manifest: null,
      loading: false,
      error: null,
      retry,
    }
  }

  const isCurrentPath = requestState.manifestPath === manifestPath
  const manifest = isCurrentPath ? requestState.manifest : null
  const loading = !isCurrentPath || requestState.loading
  const error = isCurrentPath ? requestState.error : null

  const normalizedError =
    error ??
    (!loading && !manifest
      ? new Error('No forecast manifest was returned.')
      : null)

  return { manifest, loading, error: normalizedError, retry }
}
