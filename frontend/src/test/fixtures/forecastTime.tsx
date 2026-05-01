import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { vi } from 'vitest'

import type { CycleManifest } from '../../manifest'
import {
  ForecastTimeProvider,
  type ForecastTimeContextValue,
  validTimeMs,
} from '../../forecast-time'

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
  const cycle = options.cycle ?? manifest?.cycle ?? '2026041312'
  const forecastHours = options.forecastHours ?? manifest?.forecastHours ?? ['000', '003']
  const defaultValidTimeMs = validTimeMs(cycle, forecastHours[0] ?? '000') ?? 0

  return {
    cycle,
    forecastHours,
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
  manifest: CycleManifest | null
) {
  return render(
    <ForecastTimeProvider manifest={manifest}>
      {ui}
    </ForecastTimeProvider>
  )
}
