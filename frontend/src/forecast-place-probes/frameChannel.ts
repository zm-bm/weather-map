import type { FieldInterpolationWindowData } from '../forecast-data'

export type ForecastPlaceProbeFrame = FieldInterpolationWindowData | null

export type ForecastPlaceProbeFrameListener = (
  frame: ForecastPlaceProbeFrame
) => void

export type ForecastPlaceProbeFrameChannel = {
  getSnapshot: () => ForecastPlaceProbeFrame
  publish: (frame: ForecastPlaceProbeFrame) => void
  subscribe: (listener: ForecastPlaceProbeFrameListener) => () => void
}

export function createForecastPlaceProbeFrameChannel(): ForecastPlaceProbeFrameChannel {
  let currentFrame: ForecastPlaceProbeFrame = null
  const listeners = new Set<ForecastPlaceProbeFrameListener>()

  return {
    getSnapshot() {
      return currentFrame
    },
    publish(frame) {
      currentFrame = frame
      listeners.forEach((listener) => listener(currentFrame))
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
