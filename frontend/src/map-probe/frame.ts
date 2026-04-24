import { useSyncExternalStore } from 'react'

import type { ScalarFrameWindowData } from '../forecast-layers/scalar'

let currentFrame: ScalarFrameWindowData | null = null
const listeners = new Set<() => void>()

function emitChange() {
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot() {
  return currentFrame
}

export function setProbeFrame(frame: ScalarFrameWindowData) {
  currentFrame = frame
  emitChange()
}

export function getProbeFrame(): ScalarFrameWindowData | null {
  return currentFrame
}

export function clearProbeFrame() {
  currentFrame = null
  emitChange()
}

export function useProbeFrame(): ScalarFrameWindowData | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
