import { createContext, useContext } from 'react'

import type { TimelineControls, TimelineSyncBridge, TimelineViewState } from './timelineTypes'

export type TimelineContextValue = {
  cycle: string | null
  forecastHours: string[]
  state: TimelineViewState
  controls: TimelineControls
  sync: TimelineSyncBridge
}

export const TimelineContext = createContext<TimelineContextValue | null>(null)

export function useTimelineContext(): TimelineContextValue {
  const value = useContext(TimelineContext)
  if (!value) {
    throw new Error('useTimelineContext must be used within a TimelineProvider')
  }
  return value
}
