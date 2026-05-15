import { useEffect } from 'react'

import { useAppStatusActions } from '../app-status'
import type { StartupStatus } from './types'

export function useStartupAppStatus(status: StartupStatus): void {
  const { setStatus, clearStatus } = useAppStatusActions()

  useEffect(() => {
    if (status.startupPhase === 'idle' || status.startupPhase === 'ready') {
      clearStatus('startupSync')
      return
    }

    if (status.startupPhase === 'error') {
      setStatus('startupSync', {
        mode: 'blocking',
        level: 'error',
        title: 'Forecast Startup Failed',
        detail: status.startupErrorMessage ?? 'Unknown startup error.',
        actionLabel: 'Retry',
        onAction: status.retry,
      })
      return
    }

    setStatus('startupSync', {
      mode: 'blocking',
      level: 'loading',
      title: 'Initializing Forecast Map',
      detail: 'Loading initial forecast data.',
    })
  }, [
    clearStatus,
    setStatus,
    status.startupPhase,
    status.startupErrorMessage,
    status.retry,
  ])

  useEffect(() => {
    return () => {
      clearStatus('startupSync')
    }
  }, [clearStatus])
}
