import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createForecastTimeContextValue } from '../../test/fixtures'
import MapSyncIndicator from './MapSyncIndicator'

const mocks = vi.hoisted(() => ({
  isInFlight: false,
}))

vi.mock('../../forecast-time/ForecastTimeContext', () => ({
  useForecastTimeContext: () => createForecastTimeContextValue(
    null,
    {
      state: {
        appliedTimeMs: Date.UTC(2026, 3, 9, 0, 0),
        targetTimeMs: Date.UTC(2026, 3, 9, 0, 0),
        pendingTimeMs: null,
        isInFlight: mocks.isInFlight,
        isPlaying: false,
      },
    }
  ),
}))

describe('MapSyncIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.isInFlight = false
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays hidden while no frame sync is in flight', () => {
    render(<MapSyncIndicator />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('waits before showing the in-flight map update badge', () => {
    mocks.isInFlight = true
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
    mocks.isInFlight = true
    const { rerender } = render(<MapSyncIndicator />)

    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(screen.getByRole('status')).toBeInTheDocument()

    mocks.isInFlight = false
    rerender(<MapSyncIndicator />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
