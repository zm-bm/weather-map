import type { ForecastDataTarget } from '../forecast-data'
import type { ForecastTimeSyncBridge } from '../forecast-time'

export type ForecastSyncStartupPhase = 'idle' | 'loading' | 'ready' | 'error'

export type ForecastSyncStartupStatus = {
  startupPhase: ForecastSyncStartupPhase
  startupErrorMessage: string | null
  retry: () => void
}

export type ForecastSyncStartupState = {
  status: ForecastSyncStartupStatus
  retryToken: number
  isBlocked: boolean
  handleDisabled: () => void
  handlePending: () => void
  handleApplied: () => void
  handleError: (error: Error) => void
}

export type ForecastSyncTarget = ForecastDataTarget & {
  sync: ForecastTimeSyncBridge
}
