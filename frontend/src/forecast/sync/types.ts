export type ForecastSyncStartupPhase = 'idle' | 'loading' | 'ready' | 'error'

export type ForecastSyncStartupStatus = {
  startupPhase: ForecastSyncStartupPhase
  startupErrorMessage: string | null
  retry: () => void
}
