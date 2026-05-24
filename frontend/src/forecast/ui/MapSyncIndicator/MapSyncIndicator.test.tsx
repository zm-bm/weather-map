import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ForecastTimeContextValue } from '@/forecast/time'
import {
  createForecastTimeContextValue,
  createForecastTimesFixture,
} from '@/test/fixtures'
import MapSyncIndicator from './MapSyncIndicator'

const mocks = vi.hoisted(() => ({
  timeContext: null as ForecastTimeContextValue | null,
}))

vi.mock('@/forecast/time', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/forecast/time')>()
  return {
    ...actual,
    useForecastTimeContext: () => mocks.timeContext,
  }
})

function setForecastTimeContext(state: Partial<ForecastTimeContextValue['state']> = {}) {
  mocks.timeContext = createForecastTimeContextValue(null, {
    times: createForecastTimesFixture(['000', '003'], '2026040900'),
    state: {
      appliedTimeMs: Date.UTC(2026, 3, 9, 0, 0),
      targetTimeMs: Date.UTC(2026, 3, 9, 0, 0),
      pendingTimeMs: null,
      isInFlight: false,
      isPlaying: false,
      ...state,
    },
  })
}

describe('MapSyncIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setForecastTimeContext()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays hidden while no frame sync is in flight', () => {
    render(<MapSyncIndicator />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('waits before showing the in-flight map update badge', () => {
    setForecastTimeContext({ isInFlight: true })
    render(<MapSyncIndicator />)

    act(() => {
      vi.advanceTimersByTime(149)
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByRole('status')).toHaveTextContent('Updating map')
  })

  it('hides immediately when frame sync completes', () => {
    setForecastTimeContext({ isInFlight: true })
    const { rerender } = render(<MapSyncIndicator />)

    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(screen.getByRole('status')).toBeInTheDocument()

    setForecastTimeContext({ isInFlight: false })
    rerender(<MapSyncIndicator />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
