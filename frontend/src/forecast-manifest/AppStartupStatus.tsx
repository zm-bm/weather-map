import { useEffect } from 'react'

import { useAppStatusActions } from '../app-status'
import AppStatusHost from '../components/AppStatusHost'
import type { ForecastManifestState } from './types'

export default function AppStartupStatus({ state }: { state: ForecastManifestState }) {
  const { setStatus, clearStatus } = useAppStatusActions()

  useEffect(() => {
    if (state.phase === 'ready') {
      clearStatus('forecastManifest')
      return
    }

    if (state.phase === 'error') {
      setStatus('forecastManifest', {
        mode: 'blocking',
        level: 'error',
        title: 'Forecast Load Failed',
        detail: state.error?.message ?? 'Unknown startup error.',
        actionLabel: 'Retry',
        onAction: state.retry,
      })
      return
    }

    setStatus('forecastManifest', {
      mode: 'blocking',
      level: 'loading',
      title: 'Loading Forecast',
      detail: 'Fetching forecast manifest.',
    })
  }, [
    clearStatus,
    setStatus,
    state.error,
    state.phase,
    state.retry,
  ])

  useEffect(() => {
    return () => {
      clearStatus('forecastManifest')
    }
  }, [clearStatus])

  return <AppStatusHost />
}
