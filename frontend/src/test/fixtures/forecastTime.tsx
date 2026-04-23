import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { vi } from 'vitest'

import type { CycleManifest } from '../../manifest'
import type { ForecastTimeContextValue } from '../../forecast-time/ForecastTimeContext'
import ForecastTimeProvider from '../../forecast-time/ForecastTimeProvider'

type ForecastTimeContextOptions = Partial<{
  cycle: string | null
  forecastHours: string[]
  state: Partial<ForecastTimeContextValue['state']>
  controls: Partial<ForecastTimeContextValue['controls']>
}>

export function createForecastTimeContextValue(
  manifest: CycleManifest | null,
  options: ForecastTimeContextOptions = {}
): ForecastTimeContextValue {
  return {
    cycle: options.cycle ?? manifest?.cycle ?? '2026041312',
    forecastHours: options.forecastHours ?? manifest?.forecastHours ?? ['000', '003'],
    state: {
      appliedHourIndex: 0,
      targetHourIndex: 0,
      pendingHourIndex: null,
      isInFlight: false,
      isPlaying: false,
      ...options.state,
    },
    controls: {
      requestHour: vi.fn(),
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
  manifest: CycleManifest | null
) {
  return render(
    <ForecastTimeProvider manifest={manifest}>
      {ui}
    </ForecastTimeProvider>
  )
}
