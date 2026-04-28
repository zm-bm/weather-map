import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createForecastTimeContextValue } from '../../test/fixtures'
import TimelinePanel from './TimelinePanel'

const mocks = vi.hoisted(() => ({
  requestTime: vi.fn(),
  togglePlay: vi.fn(),
  timelineState: {
    appliedTimeMs: Date.UTC(2026, 3, 9, 0, 0),
    targetTimeMs: Date.UTC(2026, 3, 9, 0, 0),
    pendingTimeMs: null as number | null,
    isInFlight: false,
    isPlaying: false,
  },
}))

vi.mock('../../forecast-time/ForecastTimeContext', () => ({
  useForecastTimeContext: () => createForecastTimeContextValue(
    null,
    {
      cycle: '2026040900',
      forecastHours: ['000', '003', '006'],
      state: mocks.timelineState,
      controls: {
        requestTime: mocks.requestTime,
        togglePlay: mocks.togglePlay,
      },
    }
  ),
}))

describe('TimelinePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.timelineState = {
      appliedTimeMs: Date.UTC(2026, 3, 9, 0, 0),
      targetTimeMs: Date.UTC(2026, 3, 9, 0, 0),
      pendingTimeMs: null,
      isInFlight: false,
      isPlaying: false,
    }
  })

  it('commits slider time only on release, not during drag changes', () => {
    render(<TimelinePanel />)

    expect(screen.queryByText('Valid Time')).not.toBeInTheDocument()
    expect(screen.queryByText('Ready')).not.toBeInTheDocument()

    const slider = screen.getByLabelText('Forecast time')
    expect(slider).toHaveAttribute('step', '10')
    fireEvent.pointerDown(slider)
    fireEvent.change(slider, { target: { value: '30' } })
    expect(mocks.requestTime).not.toHaveBeenCalled()

    fireEvent.pointerUp(slider)
    expect(mocks.requestTime).toHaveBeenCalledOnce()
    expect(mocks.requestTime).toHaveBeenCalledWith(Date.UTC(2026, 3, 9, 0, 30))
  })

  it('preserves an in-progress slider seek across playback frame updates', () => {
    mocks.timelineState = {
      appliedTimeMs: Date.UTC(2026, 3, 9, 0, 0),
      targetTimeMs: Date.UTC(2026, 3, 9, 0, 10),
      pendingTimeMs: null,
      isInFlight: true,
      isPlaying: true,
    }
    const { rerender } = render(<TimelinePanel />)

    const slider = screen.getByLabelText('Forecast time')
    fireEvent.pointerDown(slider)
    fireEvent.change(slider, { target: { value: '60' } })

    mocks.timelineState = {
      ...mocks.timelineState,
      appliedTimeMs: Date.UTC(2026, 3, 9, 0, 10),
      targetTimeMs: Date.UTC(2026, 3, 9, 0, 20),
      isInFlight: true,
    }
    rerender(<TimelinePanel />)

    const currentSlider = screen.getByLabelText('Forecast time')
    expect(currentSlider).toBe(slider)
    expect(currentSlider).toHaveValue('60')

    fireEvent.pointerUp(currentSlider)
    expect(mocks.requestTime).toHaveBeenCalledOnce()
    expect(mocks.requestTime).toHaveBeenCalledWith(Date.UTC(2026, 3, 9, 1, 0))
  })

  it('renders only the hero play control without transport status text', () => {
    mocks.timelineState = {
      appliedTimeMs: Date.UTC(2026, 3, 9, 0, 0),
      targetTimeMs: Date.UTC(2026, 3, 9, 0, 30),
      pendingTimeMs: Date.UTC(2026, 3, 9, 0, 45),
      isInFlight: true,
      isPlaying: false,
    }
    render(<TimelinePanel />)

    expect(screen.getByRole('button', { name: 'Play forecast timeline' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Previous forecast minute')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Next forecast minute')).not.toBeInTheDocument()
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/queued/i)).not.toBeInTheDocument()
  })
})
