import { useMemo, useState } from 'react'

import AppStatusHost, { type AppStatus } from './components/AppStatusHost'
import ForecastShell from './components/ForecastShell/ForecastShell'
import { useForecastManifest, type ForecastManifestState } from './forecast-manifest'
import type { ForecastSyncStartupStatus } from './forecast-sync'

export default function ForecastApp() {
  const forecast = useForecastManifest()
  const [syncStartupStatus, setSyncStartupStatus] = useState<ForecastSyncStartupStatus | null>(null)
  const appStatus = useMemo(
    () => getForecastAppStatus(forecast, syncStartupStatus),
    [forecast, syncStartupStatus]
  )

  return (
    <div className="app-root">
      <ForecastShell
        forecast={forecast.data}
        onSyncStartupStatusChange={setSyncStartupStatus}
      />
      <AppStatusHost status={appStatus} />
    </div>
  )
}

function getForecastAppStatus(
  forecast: ForecastManifestState,
  syncStartupStatus: ForecastSyncStartupStatus | null
): AppStatus {
  if (forecast.phase === 'loading') {
    return {
      mode: 'blocking',
      level: 'loading',
      title: 'Loading Forecast',
      detail: 'Fetching forecast manifest.',
    }
  }

  if (forecast.phase === 'error') {
    return {
      mode: 'blocking',
      level: 'error',
      title: 'Forecast Load Failed',
      detail: forecast.error?.message ?? 'Unknown startup error.',
      actionLabel: 'Retry',
      onAction: forecast.retry,
    }
  }

  if (syncStartupStatus?.startupPhase === 'loading') {
    return {
      mode: 'blocking',
      level: 'loading',
      title: 'Initializing Forecast Map',
      detail: 'Loading initial forecast data.',
    }
  }

  if (syncStartupStatus?.startupPhase === 'error') {
    return {
      mode: 'blocking',
      level: 'error',
      title: 'Forecast Startup Failed',
      detail: syncStartupStatus.startupErrorMessage ?? 'Unknown startup error.',
      actionLabel: 'Retry',
      onAction: syncStartupStatus.retry,
    }
  }

  return null
}
