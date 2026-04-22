export type ForecastTimeViewState = {
  appliedHourIndex: number
  targetHourIndex: number
  pendingHourIndex: number | null
  isInFlight: boolean
  isPlaying: boolean
}

export type ForecastTimeControls = {
  requestHour: (hourIndex: number) => void
  requestNext: () => void
  requestPrev: () => void
  togglePlay: () => void
}

export type ForecastTimeSyncBridge = {
  onRequestStart: (hourIndex: number) => void
  onRequestApplied: (hourIndex: number) => void
  onRequestError: (hourIndex: number, error?: Error) => void
}
