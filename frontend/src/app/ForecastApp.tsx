import { useMemo, useState } from 'react'

import AppStatusHost, { type AppStatus } from '@/app/AppStatusHost'
import ForecastShell from '@/forecast/ui/ForecastShell'
import { useForecastManifest, type ForecastManifestState } from '@/forecast/manifest'
import type { ForecastSyncInitialStatus } from '@/forecast/sync'

export default function ForecastApp() {
  const forecast = useForecastManifest()
  const [initialSyncStatus, setInitialSyncStatus] = useState<ForecastSyncInitialStatus | null>(null)
  const appStatus = useMemo(
    () => getForecastAppStatus(forecast, initialSyncStatus),
    [forecast, initialSyncStatus]
  )

  return (
    <div className="app-root">
      <ForecastShell
        forecast={forecast.data}
        onInitialSyncStatusChange={setInitialSyncStatus}
      />
      <AppStatusHost status={appStatus} />
    </div>
  )
}

function getForecastAppStatus(
  forecast: ForecastManifestState,
  initialSyncStatus: ForecastSyncInitialStatus | null
): AppStatus {
  if (forecast.phase === 'loading') {
    return {
      mode: 'blocking',
      level: 'loading',
      title: 'Loading Forecast',
      detail: 'Fetching manifest index.',
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

  if (initialSyncStatus?.phase === 'loading') {
    return {
      mode: 'blocking',
      level: 'loading',
      title: 'Initializing Forecast Map',
      detail: 'Loading initial forecast data.',
    }
  }

  if (initialSyncStatus?.phase === 'error') {
    return {
      mode: 'blocking',
      level: 'error',
      title: 'Forecast Startup Failed',
      detail: initialSyncStatus.errorMessage ?? 'Unknown startup error.',
      actionLabel: 'Retry',
      onAction: initialSyncStatus.retry,
    }
  }

  return null
}
