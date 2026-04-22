import type { CycleManifest, ScalarVariableId, VectorVariableId } from '../manifest'
import type { ForecastTimeSyncBridge } from '../forecast-time/types'

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

export type SyncRequest = {
  manifest: CycleManifest
  activeScalar: ScalarVariableId
  activeVector: VectorVariableId
  hourIndex: number
  hourToken: string
  requestKey: string
  sync: ForecastTimeSyncBridge
}
