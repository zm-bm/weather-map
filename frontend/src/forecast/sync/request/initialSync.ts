import { useCallback, useMemo, useRef, useState } from 'react'

const DEFAULT_INITIAL_SYNC_ERROR_MESSAGE = 'Unknown startup error.'

type InitialSyncPhase = 'idle' | 'loading' | 'ready' | 'error'

export type ForecastSyncInitialStatus = {
  phase: InitialSyncPhase
  errorMessage: string | null
  retry: () => void
}

export type InitialSyncController = {
  status: ForecastSyncInitialStatus
  retryToken: number
  isBlocked: boolean
  handleDisabled: () => void
  handlePending: () => void
  handleApplied: () => void
  handleError: (error: Error) => void
}

export function useInitialSyncController(): InitialSyncController {
  const [phase, setPhase] = useState<InitialSyncPhase>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [retryToken, setRetryToken] = useState(0)
  const hasInitialSyncAppliedRef = useRef(false)

  const retry = useCallback(() => {
    setErrorMessage(null)
    setPhase((phase) => (phase === 'error' ? 'loading' : phase))
    setRetryToken((value) => value + 1)
  }, [])

  const handleDisabled = useCallback(() => {
    hasInitialSyncAppliedRef.current = false
    setPhase('idle')
    setErrorMessage(null)
    setRetryToken(0)
  }, [])

  const handlePending = useCallback(() => {
    if (hasInitialSyncAppliedRef.current) return
    setPhase('loading')
  }, [])

  const handleApplied = useCallback(() => {
    hasInitialSyncAppliedRef.current = true
    setErrorMessage(null)
    setPhase('ready')
  }, [])

  const handleError = useCallback((error: Error) => {
    if (hasInitialSyncAppliedRef.current) return
    setErrorMessage(error.message || DEFAULT_INITIAL_SYNC_ERROR_MESSAGE)
    setPhase('error')
  }, [])

  const status = useMemo<ForecastSyncInitialStatus>(() => ({
    phase,
    errorMessage,
    retry,
  }), [retry, errorMessage, phase])

  return {
    status,
    retryToken,
    isBlocked: errorMessage != null,
    handleDisabled,
    handlePending,
    handleApplied,
    handleError,
  }
}
