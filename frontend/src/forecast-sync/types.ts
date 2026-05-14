import type { ForecastFrameTarget } from '../forecast-frame'
import type { ForecastTimeSyncBridge } from '../forecast-time'

export type StartupPhase = 'idle' | 'loading' | 'ready' | 'error'

export type StartupStatus = {
  startupPhase: StartupPhase
  startupErrorMessage: string | null
  retry: () => void
}

export type StartupState = {
  status: StartupStatus
  retryToken: number
  isBlocked: boolean
  handleDisabled: () => void
  handlePending: () => void
  handleApplied: () => void
  handleError: (error: Error) => void
}

export type ForecastSyncTarget = ForecastFrameTarget & {
  sync: ForecastTimeSyncBridge
}
