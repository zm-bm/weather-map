import { useMemo } from 'react'

import { useForecastSelectionContext } from '../forecast-selection/ForecastSelectionContext'
import { useForecastTimeContext } from '../forecast-time/ForecastTimeContext'
import {
  frameWindowMinuteOffset,
  resolveForecastFrameWindow,
} from '../forecast-time/time'
import type { SyncRequest } from './types'

export function useSyncRequest(retryToken: number): SyncRequest | null {
  const {
    manifest,
    activeScalar,
    activeVector,
  } = useForecastSelectionContext()
  const {
    state: timelineState,
    sync,
  } = useForecastTimeContext()

  return useMemo(() => {
    if (manifest == null || activeScalar == null || activeVector == null) {
      return null
    }

    const frameWindow = resolveForecastFrameWindow(
      manifest.cycle,
      manifest.forecastHours,
      timelineState.targetTimeMs
    )
    const minuteOffset = frameWindowMinuteOffset(frameWindow)

    return {
      manifest,
      activeScalar,
      activeVector,
      selectedValidTimeMs: frameWindow.selectedValidTimeMs,
      lowerHourToken: frameWindow.lowerHourToken,
      upperHourToken: frameWindow.upperHourToken,
      mix: frameWindow.mix,
      requestKey: `${manifest.cycle}:${activeScalar}:${activeVector}:${frameWindow.lowerHourToken}:${frameWindow.upperHourToken}:${minuteOffset}:${retryToken}`,
      sync,
    }
  }, [
    activeScalar,
    activeVector,
    manifest,
    retryToken,
    sync,
    timelineState.targetTimeMs,
  ])
}
