import { useCallback, useMemo, useRef, useState } from 'react'

const DEFAULT_STARTUP_ERROR_MESSAGE = 'Unknown startup error.'

export type StartupPhase = 'idle' | 'loading' | 'ready' | 'error'

export type StartupSyncStatus = {
  startupPhase: StartupPhase
  startupErrorMessage: string | null
  retry: () => void
}

export type StartupSyncState = {
  status: StartupSyncStatus
  retryToken: number
  isStartupBlocked: boolean
  handleDisabled: () => void
  handlePending: () => void
  handleApplied: () => void
  handleError: (error: Error) => void
}

export function useStartupSyncState(): StartupSyncState {
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

  const status = useMemo<StartupSyncStatus>(() => ({
    startupPhase,
    startupErrorMessage,
    retry,
  }), [retry, startupErrorMessage, startupPhase])

  return {
    status,
    retryToken,
    isStartupBlocked: startupErrorMessage != null,
    handleDisabled,
    handlePending,
    handleApplied,
    handleError,
  }
}
