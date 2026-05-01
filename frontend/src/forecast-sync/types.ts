import type { CycleManifest, ScalarVariableId, VectorVariableId } from '../manifest'
import type { ForecastFrameSelection } from '../forecast-time'
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

export type SyncRequest = ForecastFrameSelection & {
  manifest: CycleManifest
  activeScalar: ScalarVariableId
  activeVector: VectorVariableId
  requestKey: string
  sync: ForecastTimeSyncBridge
}
