import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { vi } from 'vitest'

import {
  activeForecastRunForModel,
  type ForecastModelId,
  type Manifest,
} from '../../forecast-manifest'
import {
  ForecastTimeProvider,
  type ForecastTimeContextValue,
} from '../../forecast-time'
import type { ForecastTimelineTime } from '../../forecast-time'
import { createForecastTimesFixture } from './manifest'

type ForecastTimeContextOptions = Partial<{
  times: ForecastTimelineTime[]
  state: Partial<ForecastTimeContextValue['state']>
  controls: Partial<ForecastTimeContextValue['controls']>
}>

export function createForecastTimeContextValue(
  manifest: Manifest | null,
  options: ForecastTimeContextOptions = {}
): ForecastTimeContextValue {
  const times = options.times ?? activeForecastRunForModel(manifest, 'gfs')?.latest.times ?? createForecastTimesFixture()
  const defaultValidTimeMs = Date.parse(times[0]?.validAt ?? '2026-04-13T12:00:00Z')

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
    sync: {
      onRequestStart: vi.fn(),
      onRequestApplied: vi.fn(),
      onRequestError: vi.fn(),
    },
  }
}

export function renderWithForecastTime(
  ui: ReactNode,
  manifest: Manifest | null,
  activeModelId: ForecastModelId | null = 'gfs'
) {
  const activeRun = activeForecastRunForModel(manifest, activeModelId)
  return render(
    <ForecastTimeProvider activeRun={activeRun}>
      {ui}
    </ForecastTimeProvider>
  )
}
