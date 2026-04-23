import { useMemo } from 'react'

import { useForecastSelectionContext } from '../forecast-selection/ForecastSelectionContext'
import { useForecastTimeContext } from '../forecast-time/ForecastTimeContext'
import { hourTokenAt, normalizeHourIndex } from '../forecast-time/time'
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

    const hourIndex = normalizeHourIndex(
      timelineState.targetHourIndex,
      manifest.forecastHours.length
    )
    const hourToken = hourTokenAt(manifest.forecastHours, hourIndex)

    return {
      manifest,
      activeScalar,
      activeVector,
      hourIndex,
      hourToken,
      requestKey: `${manifest.cycle}:${activeScalar}:${activeVector}:${hourToken}:${retryToken}`,
      sync,
    }
  }, [
    activeScalar,
    activeVector,
    manifest,
    retryToken,
    sync,
    timelineState.targetHourIndex,
  ])
}
