import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TimelinePanel from './TimelinePanel'

const mocks = vi.hoisted(() => ({
  requestHour: vi.fn(),
  requestPrev: vi.fn(),
  requestNext: vi.fn(),
  togglePlay: vi.fn(),
  timelineState: {
    appliedHourIndex: 0,
    targetHourIndex: 0,
    pendingHourIndex: null as number | null,
    isInFlight: false,
    isPlaying: false,
  },
}))

vi.mock('../../forecast-time/ForecastTimeContext', () => ({
  useForecastTimeContext: () => ({
    cycle: '2026040900',
    forecastHours: ['000', '003', '006'],
    state: mocks.timelineState,
    controls: {
      requestHour: mocks.requestHour,
      requestPrev: mocks.requestPrev,
      requestNext: mocks.requestNext,
      togglePlay: mocks.togglePlay,
    },
    sync: {
      onRequestStart: vi.fn(),
      onRequestApplied: vi.fn(),
      onRequestError: vi.fn(),
    },
  }),
}))

describe('TimelinePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.timelineState = {
      appliedHourIndex: 0,
      targetHourIndex: 0,
      pendingHourIndex: null,
      isInFlight: false,
      isPlaying: false,
    }
  })

  it('commits slider hour only on release, not during drag changes', () => {
    render(<TimelinePanel />)

    expect(screen.queryByText('Valid Time')).not.toBeInTheDocument()
    expect(screen.queryByText('Ready')).not.toBeInTheDocument()

    const slider = screen.getByLabelText('Forecast step')
    fireEvent.pointerDown(slider)
    fireEvent.change(slider, { target: { value: '2' } })
    expect(mocks.requestHour).not.toHaveBeenCalled()

    fireEvent.pointerUp(slider)
    expect(mocks.requestHour).toHaveBeenCalledOnce()
    expect(mocks.requestHour).toHaveBeenCalledWith(2)
  })

  it('shows loading and queued status text', () => {
    mocks.timelineState = {
      appliedHourIndex: 0,
      targetHourIndex: 1,
      pendingHourIndex: 2,
      isInFlight: true,
      isPlaying: false,
    }
    render(<TimelinePanel />)

    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(screen.getByText(/queued/i)).toBeInTheDocument()
  })
})
