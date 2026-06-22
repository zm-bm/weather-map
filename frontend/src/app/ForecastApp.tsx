import { useState } from 'react'

import AppStatusHost, { type AppStatus } from '@/app/AppStatusHost'
import ForecastShell from '@/forecast/ui/ForecastShell'
import {
  useForecastManifest,
  type ForecastManifestState,
} from '@/forecast/manifest'
import type { ForecastSyncInitialStatus } from '@/forecast/sync'

const MANIFEST_LOADING_STATUS = {
  kind: 'loading',
  title: 'Loading Forecast',
} as const satisfies AppStatus

const FIELD_LOADING_STATUS = {
  kind: 'loading',
  title: 'Loading Map Field',
} as const satisfies AppStatus

export default function ForecastApp() {
  const forecast = useForecastManifest()
  const [initialSyncStatus, setInitialSyncStatus] = useState<ForecastSyncInitialStatus | null>(null)
  const [fieldUpdateLoading, setFieldUpdateLoading] = useState(false)
  const appStatus = getForecastAppStatus(forecast, initialSyncStatus, fieldUpdateLoading)

  return (
    <div className="app-root">
      <ForecastShell
        forecast={forecast.data}
        onInitialSyncStatusChange={setInitialSyncStatus}
        onFieldLoadingChange={setFieldUpdateLoading}
      />
      <AppStatusHost status={appStatus} />
    </div>
  )
}

function getForecastAppStatus(
  forecast: ForecastManifestState,
  initialSyncStatus: ForecastSyncInitialStatus | null,
  fieldUpdateLoading: boolean
): AppStatus {
  if (forecast.phase === 'loading') {
    return MANIFEST_LOADING_STATUS
  }

  if (forecast.phase === 'error') {
    return {
      kind: 'error',
      title: 'Forecast Feed Offline',
      detail: forecast.error?.message ?? 'Unknown startup error.',
      hint: 'Retry reconnects to the forecast catalog. If this continues, the latest manifest may be unavailable or unreachable.',
      actionLabel: 'Retry Feed',
      onAction: forecast.retry,
    }
  }

  if (initialSyncStatus?.phase === 'error') {
    return {
      kind: 'error',
      title: 'Field Startup Failed',
      detail: initialSyncStatus.errorMessage ?? 'Unknown startup error.',
      hint: 'Retry reloads the current field data and restarts renderer setup for this source and cycle.',
      actionLabel: 'Retry Field',
      onAction: initialSyncStatus.retry,
    }
  }

  if (initialSyncStatus?.phase === 'loading' || fieldUpdateLoading) {
    return FIELD_LOADING_STATUS
  }

  return null
}
