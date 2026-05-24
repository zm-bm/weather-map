import { createContext, useContext } from 'react'

import type {
  ForecastTimeControls,
  ForecastTimeSyncCallbacks,
  ForecastTimeViewState,
} from './types'
import type { ForecastTimelineTime } from './time'

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
