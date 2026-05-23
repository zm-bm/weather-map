import type { FieldInterpolationWindowData } from '../forecast-data'

export type ForecastPlaceProbeFrame = FieldInterpolationWindowData | null

type FrameListener = (
  frame: ForecastPlaceProbeFrame
) => void

export type ForecastPlaceProbeFrameChannel = {
  getSnapshot: () => ForecastPlaceProbeFrame
  publish: (frame: ForecastPlaceProbeFrame) => void
  subscribe: (listener: FrameListener) => () => void
}

export function createForecastPlaceProbeFrameChannel(): ForecastPlaceProbeFrameChannel {
  let snapshot: ForecastPlaceProbeFrame = null
  const listeners = new Set<FrameListener>()

  return {
    getSnapshot() {
      return snapshot
    },
    publish(frame) {
      snapshot = frame
      listeners.forEach((listener) => listener(snapshot))
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
