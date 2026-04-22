import { useCallback, useMemo, useRef, useState } from 'react'

import type { StartupState, StartupStatus, StartupPhase } from './types'

const DEFAULT_STARTUP_ERROR_MESSAGE = 'Unknown startup error.'

export function useStartupState(): StartupState {
  const [startupPhase, setStartupPhase] = useState<StartupPhase>('idle')
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

  const status = useMemo<StartupStatus>(() => ({
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
