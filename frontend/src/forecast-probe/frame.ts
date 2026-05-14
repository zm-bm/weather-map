import type { FieldFrameWindowData } from '../forecast-frame'

export type ForecastFieldFrameListener = (frame: FieldFrameWindowData | null) => void

let currentFrame: FieldFrameWindowData | null = null
const listeners = new Set<ForecastFieldFrameListener>()

function emitChange() {
  listeners.forEach((listener) => listener(currentFrame))
}

export function setForecastFieldFrame(frame: FieldFrameWindowData) {
  currentFrame = frame
  emitChange()
}

export function getForecastFieldFrame(): FieldFrameWindowData | null {
  return currentFrame
}

export function subscribeForecastFieldFrame(listener: ForecastFieldFrameListener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function clearForecastFieldFrame() {
  currentFrame = null
  emitChange()
}
