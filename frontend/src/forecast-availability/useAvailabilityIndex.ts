import { useCallback, useEffect, useState } from 'react'

import { isAbortError, normalizeError } from '../abort'
import { fetchAvailabilityIndex } from './fetch'
import type { ModelLayerAvailabilityIndex } from './schema'

export type UseAvailabilityIndexResult = {
  availabilityIndex: ModelLayerAvailabilityIndex | null
  loading: boolean
  error: Error | null
  retry: () => void
}

type AvailabilityRequestState = {
  availabilityIndex: ModelLayerAvailabilityIndex | null
  loading: boolean
  error: Error | null
}

export function useAvailabilityIndex(): UseAvailabilityIndexResult {
  const [requestState, setRequestState] = useState<AvailabilityRequestState>(() => ({
    availabilityIndex: null,
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
        availabilityIndex: null,
        loading: true,
        error: null,
      })

      const availabilityIndex = await fetchAvailabilityIndex({ signal: ac.signal })
      if (ac.signal.aborted) return
      setRequestState({
        availabilityIndex,
        loading: false,
        error: null,
      })
    }

    run().catch((err) => {
      if (isAbortError(err)) return
      if (ac.signal.aborted) return
      setRequestState({
        availabilityIndex: null,
        loading: false,
        error: normalizeError(err),
      })
    })

    return () => ac.abort()
  }, [retryToken])

  const normalizedError =
    requestState.error ??
    (!requestState.loading && !requestState.availabilityIndex
      ? new Error('No forecast availability index was returned.')
      : null)

  return {
    availabilityIndex: requestState.availabilityIndex,
    loading: requestState.loading,
    error: normalizedError,
    retry,
  }
}
