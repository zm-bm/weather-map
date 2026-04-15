import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TimelineTransport from './TimelineTransport'

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

vi.mock('../../state/TimelineContext', () => ({
  useTimelineContext: () => ({
    cycle: '2026040900',
    forecastHours: ['000', '003', '006'],
    state: mocks.timelineState,
    controls: {
      requestHour: mocks.requestHour,
      requestPrev: mocks.requestPrev,
      requestNext: mocks.requestNext,
      togglePlay: mocks.togglePlay,
    },
    sync: {},
  }),
}))

describe('TimelineTransport', () => {
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
    render(<TimelineTransport />)

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
    render(<TimelineTransport />)

    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(screen.getByText(/queued/i)).toBeInTheDocument()
  })
})
