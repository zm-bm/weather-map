import { useEffect } from 'react'

import { useAppStatus } from '../state/appStatus'
import type { StartupSyncStatus } from './useStartupSyncState'

type UseForecastMapStatusArgs = {
  status: StartupSyncStatus
}

export function useForecastMapStatus({
  status,
}: UseForecastMapStatusArgs) {
  const { setStatus, clearStatus } = useAppStatus()

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
      detail: 'Loading initial weather and wind frames.',
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
