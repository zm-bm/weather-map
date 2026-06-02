import { vi } from 'vitest'

import {
  activeForecastRunForDataset,
  type Manifest,
} from '@/forecast/manifest'
import {
  type ForecastTimeContextValue,
} from '@/forecast/time'
import type { ForecastTimelineTime } from '@/forecast/time'
import { createForecastTimesFixture } from './manifest'

type ForecastTimeContextOptions = Partial<{
  times: ForecastTimelineTime[]
  state: Partial<ForecastTimeContextValue['state']>
  controls: Partial<ForecastTimeContextValue['controls']>
  syncCallbacks: Partial<ForecastTimeContextValue['syncCallbacks']>
}>

export function createForecastTimeContextValue(
  manifest: Manifest | null,
  options: ForecastTimeContextOptions = {}
): ForecastTimeContextValue {
  const times = options.times ?? activeForecastRunForDataset(manifest, 'gfs')?.latest.frames ?? createForecastTimesFixture()
  const defaultValidTimeMs = Date.parse(times[0]?.valid_at ?? '2026-04-13T12:00:00Z')

  return {
    times,
    state: {
      appliedTimeMs: defaultValidTimeMs,
      targetTimeMs: defaultValidTimeMs,
      pendingTimeMs: null,
      isInFlight: false,
      isPlaying: false,
      ...options.state,
    },
    controls: {
      requestTime: vi.fn(),
      requestNext: vi.fn(),
      requestPrev: vi.fn(),
      togglePlay: vi.fn(),
      ...options.controls,
    },
    syncCallbacks: {
      onRequestStart: vi.fn(),
      onRequestApplied: vi.fn(),
      onRequestError: vi.fn(),
      ...options.syncCallbacks,
    },
  }
}
