import { createContext, useContext } from 'react'

import type { ForecastTimelineTime } from './time'

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

export type ForecastTimeSyncCallbacks = {
  onRequestStart: (timeMs: number) => void
  onRequestApplied: (timeMs: number) => void
  onRequestError: (timeMs: number, error?: Error) => void
}

export type ForecastTimeContextValue = {
  times: ForecastTimelineTime[]
  state: ForecastTimeViewState
  controls: ForecastTimeControls
  syncCallbacks: ForecastTimeSyncCallbacks
}

export const ForecastTimeContext = createContext<ForecastTimeContextValue | null>(null)

export function useForecastTimeContext(): ForecastTimeContextValue {
  const value = useContext(ForecastTimeContext)
  if (!value) {
    throw new Error('useForecastTimeContext must be used within a ForecastTimeProvider')
  }
  return value
}
