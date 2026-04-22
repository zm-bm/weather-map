import { useCallback, useEffect, useState } from 'react'

import { fetchCurrentManifest } from './fetch'
import type { CycleManifest } from './types'
import { isAbortError, normalizeError } from '../abort'

export type UseManifestResult = {
  manifest: CycleManifest | null
  loading: boolean
  error: Error | null
  retry: () => void
}

export function useManifest(): UseManifestResult {
  const [manifest, setManifest] = useState<CycleManifest | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<Error | null>(null)
  const [retryToken, setRetryToken] = useState(0)

  const retry = useCallback(() => {
    setRetryToken((token) => token + 1)
  }, [])

  useEffect(() => {
    const ac = new AbortController()

    const run = async () => {
      setLoading(true)
      setError(null)
      setManifest(null)

      setManifest(await fetchCurrentManifest({ signal: ac.signal }))
    }

    run().catch((err) => {
      if (isAbortError(err)) return
      setError(normalizeError(err))
      setManifest(null)
    }).finally(() => {
      if (!ac.signal.aborted) setLoading(false)
    })

    return () => ac.abort()
  }, [retryToken])

  const normalizedError =
    error ??
    (!loading && !manifest
      ? new Error('No forecast manifest was returned.')
      : null)

  return { manifest, loading, error: normalizedError, retry }
}
