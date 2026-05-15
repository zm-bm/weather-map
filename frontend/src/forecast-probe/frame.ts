import type { FieldInterpolationWindowData } from '../forecast-data'

export type ForecastFieldDataListener = (frame: FieldInterpolationWindowData | null) => void

let currentFrame: FieldInterpolationWindowData | null = null
const listeners = new Set<ForecastFieldDataListener>()

function emitChange() {
  listeners.forEach((listener) => listener(currentFrame))
}

export function setForecastFieldData(frame: FieldInterpolationWindowData) {
  currentFrame = frame
  emitChange()
}

export function getForecastFieldData(): FieldInterpolationWindowData | null {
  return currentFrame
}

export function subscribeForecastFieldData(listener: ForecastFieldDataListener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function clearForecastFieldData() {
  currentFrame = null
  emitChange()
}
