export type ForecastTimeViewState = {
  appliedTimeMs: number
  targetTimeMs: number
  pendingTimeMs: number | null
  isInFlight: boolean
  isPlaying: boolean
}

export type ForecastTimeControls = {
  requestTime: (timeMs: number) => void
  requestNext: () => void
  requestPrev: () => void
  togglePlay: () => void
}

export type ForecastTimeSyncBridge = {
  onRequestStart: (timeMs: number) => void
  onRequestApplied: (timeMs: number) => void
  onRequestError: (timeMs: number, error?: Error) => void
}
