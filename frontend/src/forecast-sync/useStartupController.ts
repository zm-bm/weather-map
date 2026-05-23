import { useCallback, useMemo, useRef, useState } from 'react'

import type {
  ForecastSyncStartupPhase,
  ForecastSyncStartupStatus,
} from './types'

const DEFAULT_STARTUP_ERROR_MESSAGE = 'Unknown startup error.'

export type StartupController = {
  status: ForecastSyncStartupStatus
  retryToken: number
  isBlocked: boolean
  handleDisabled: () => void
  handlePending: () => void
  handleApplied: () => void
  handleError: (error: Error) => void
}

export function useStartupController(): StartupController {
  const [startupPhase, setStartupPhase] = useState<ForecastSyncStartupPhase>('idle')
  const [startupErrorMessage, setStartupErrorMessage] = useState<string | null>(null)
  const [retryToken, setRetryToken] = useState(0)
  const hasStartupAppliedRef = useRef(false)

  const retry = useCallback(() => {
    setStartupErrorMessage(null)
    setStartupPhase((phase) => (phase === 'error' ? 'loading' : phase))
    setRetryToken((value) => value + 1)
  }, [])

  const handleDisabled = useCallback(() => {
    hasStartupAppliedRef.current = false
    setStartupPhase('idle')
    setStartupErrorMessage(null)
    setRetryToken(0)
  }, [])

  const handlePending = useCallback(() => {
    if (hasStartupAppliedRef.current) return
    setStartupPhase('loading')
  }, [])

  const handleApplied = useCallback(() => {
    hasStartupAppliedRef.current = true
    setStartupErrorMessage(null)
    setStartupPhase('ready')
  }, [])

  const handleError = useCallback((error: Error) => {
    if (hasStartupAppliedRef.current) return
    setStartupErrorMessage(error.message || DEFAULT_STARTUP_ERROR_MESSAGE)
    setStartupPhase('error')
  }, [])

  const status = useMemo<ForecastSyncStartupStatus>(() => ({
    startupPhase,
    startupErrorMessage,
    retry,
  }), [retry, startupErrorMessage, startupPhase])

  return {
    status,
    retryToken,
    isBlocked: startupErrorMessage != null,
    handleDisabled,
    handlePending,
    handleApplied,
    handleError,
  }
}
