import { useMemo } from 'react'

import type { FrameSyncRequest } from '../hooks/frameSyncTypes'
import { hourTokenAt, normalizeHourIndex } from '../map/time/core'
import { useTimelineContext } from './TimelineContext'
import { useVariableContext } from './VariableContext'

export function useFrameSyncRequest(retryToken: number): FrameSyncRequest | null {
  const {
    manifest,
    activeScalar,
    activeVector,
  } = useVariableContext()
  const {
    state: timelineState,
    sync,
  } = useTimelineContext()

  return useMemo(() => {
    if (manifest == null || activeScalar == null || activeVector == null) {
      return null
    }

    const activeHourIndex = normalizeHourIndex(
      timelineState.targetHourIndex,
      manifest.forecastHours.length
    )
    const hourToken = hourTokenAt(manifest.forecastHours, activeHourIndex)

    return {
      manifest,
      activeScalar,
      activeVector,
      activeHourIndex,
      hourToken,
      syncKey: `${manifest.cycle}:${activeScalar}:${activeVector}:${hourToken}:${retryToken}`,
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
