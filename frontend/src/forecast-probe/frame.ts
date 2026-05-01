import type { ScalarFrameWindowData } from '../forecast-frame/scalar'

export type ForecastProbeFrameListener = (frame: ScalarFrameWindowData | null) => void

let currentFrame: ScalarFrameWindowData | null = null
const listeners = new Set<ForecastProbeFrameListener>()

function emitChange() {
  listeners.forEach((listener) => listener(currentFrame))
}

export function setForecastProbeFrame(frame: ScalarFrameWindowData) {
  currentFrame = frame
  emitChange()
}

export function getForecastProbeFrame(): ScalarFrameWindowData | null {
  return currentFrame
}

export function subscribeForecastProbeFrame(listener: ForecastProbeFrameListener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function clearForecastProbeFrame() {
  currentFrame = null
  emitChange()
}
