import { useEffect } from 'react'

import { useAppStatusActions } from '../app-status'
import AppStatusHost from '../components/AppStatusHost'
import type { ForecastBootstrapState } from './types'

export default function AppStartupStatus({ state }: { state: ForecastBootstrapState }) {
  const { setStatus, clearStatus } = useAppStatusActions()

  useEffect(() => {
    if (state.phase === 'ready') {
      clearStatus('forecastBootstrap')
      return
    }

    if (state.phase === 'error') {
      setStatus('forecastBootstrap', {
        mode: 'blocking',
        level: 'error',
        title: 'Forecast Load Failed',
        detail: state.error?.message ?? 'Unknown startup error.',
        actionLabel: 'Retry',
        onAction: state.retry,
      })
      return
    }

    setStatus('forecastBootstrap', {
      mode: 'blocking',
      level: 'loading',
      title: 'Loading Forecast',
      detail: 'Fetching forecast layer availability.',
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
      clearStatus('forecastBootstrap')
    }
  }, [clearStatus])

  return <AppStatusHost />
}
