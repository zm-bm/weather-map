import { useSyncExternalStore } from 'react'

import type { ScalarFrameData } from '../forecast-layers/scalar'

let currentFrame: ScalarFrameData | null = null
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

export function setProbeFrame(frame: ScalarFrameData) {
  currentFrame = frame
  emitChange()
}

export function getProbeFrame(): ScalarFrameData | null {
  return currentFrame
}

export function clearProbeFrame() {
  currentFrame = null
  emitChange()
}

export function useProbeFrame(): ScalarFrameData | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
