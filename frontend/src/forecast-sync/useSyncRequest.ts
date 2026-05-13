import { useMemo } from 'react'

import { useForecastSelectionContext } from '../forecast-selection'
import { getScalarLayerSpec } from '../forecast-catalog'
import { useForecastTimeContext } from '../forecast-time'
import {
  frameWindowMinuteOffset,
  resolveForecastFrameWindow,
} from '../forecast-time'
import type { SyncRequest } from './types'

export function useSyncRequest(retryToken: number): SyncRequest | null {
  const {
    manifest,
    activeScalar,
    scalarLayers,
    activeVector,
  } = useForecastSelectionContext()
  const {
    state: timelineState,
    sync,
  } = useForecastTimeContext()

  return useMemo(() => {
    if (manifest == null || activeScalar == null || activeVector == null || scalarLayers == null) {
      return null
    }
    const activeScalarLayer = getScalarLayerSpec(activeScalar, scalarLayers)

    const frameWindow = resolveForecastFrameWindow(
      manifest.times,
      timelineState.targetTimeMs
    )
    const minuteOffset = frameWindowMinuteOffset(frameWindow)

    return {
      manifest,
      activeScalar,
      activeScalarLayer,
      activeVector,
      selectedValidTimeMs: frameWindow.selectedValidTimeMs,
      lowerHourToken: frameWindow.lowerHourToken,
      upperHourToken: frameWindow.upperHourToken,
      mix: frameWindow.mix,
      requestKey: `${manifest.run.cycle}:${manifest.run.revision}:${activeScalar}:${activeVector}:${frameWindow.lowerHourToken}:${frameWindow.upperHourToken}:${minuteOffset}:${retryToken}`,
      sync,
    }
  }, [
    activeScalar,
    activeVector,
    manifest,
    retryToken,
    scalarLayers,
    sync,
    timelineState.targetTimeMs,
  ])
}
