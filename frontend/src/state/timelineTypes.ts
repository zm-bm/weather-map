import type { FrameSyncCallbacks } from '../hooks/frameSyncTypes'

export type TimelineViewState = {
  appliedHourIndex: number
  targetHourIndex: number
  pendingHourIndex: number | null
  isInFlight: boolean
  isPlaying: boolean
}

export type TimelineControls = {
  requestHour: (hourIndex: number) => void
  requestNext: () => void
  requestPrev: () => void
  togglePlay: () => void
}

export type TimelineSyncBridge = Required<FrameSyncCallbacks>
