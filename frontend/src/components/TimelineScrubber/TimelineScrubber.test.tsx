import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { formatValidTimeLabel } from '../../forecast-time'
import TimelineScrubber from './TimelineScrubber'

const mocks = vi.hoisted(() => ({
  cycle: '2026040900',
  forecastHours: ['000', '003', '006'],
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

vi.mock('../../forecast-time', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../forecast-time')>()
  return {
    ...actual,
    useForecastTimeContext: () => ({
      cycle: mocks.cycle,
      forecastHours: mocks.forecastHours,
      state: mocks.timelineState,
      controls: {
        requestNext: vi.fn(),
        requestPrev: vi.fn(),
        requestTime: mocks.requestTime,
        togglePlay: mocks.togglePlay,
      },
      sync: {
        onRequestStart: vi.fn(),
        onRequestApplied: vi.fn(),
        onRequestError: vi.fn(),
      },
    }),
  }
})

describe('TimelineScrubber', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.cycle = '2026040900'
    mocks.forecastHours = ['000', '003', '006']
    mocks.timelineState = {
      appliedTimeMs: Date.UTC(2026, 3, 9, 0, 0),
      targetTimeMs: Date.UTC(2026, 3, 9, 0, 0),
      pendingTimeMs: null,
      isInFlight: false,
      isPlaying: false,
    }
  })

  it('commits slider time only on release, not during drag changes', () => {
    render(<TimelineScrubber />)

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
    const { rerender } = render(<TimelineScrubber />)

    const slider = screen.getByLabelText('Forecast time')
    fireEvent.pointerDown(slider)
    fireEvent.change(slider, { target: { value: '60' } })
    expect(screen.getByText(formatValidTimeLabel(Date.UTC(2026, 3, 9, 1, 0)) ?? '')).toBeInTheDocument()

    mocks.timelineState = {
      ...mocks.timelineState,
      appliedTimeMs: Date.UTC(2026, 3, 9, 0, 10),
      targetTimeMs: Date.UTC(2026, 3, 9, 0, 20),
      isInFlight: true,
    }
    rerender(<TimelineScrubber />)

    const currentSlider = screen.getByLabelText('Forecast time')
    expect(currentSlider).toBe(slider)
    expect(currentSlider).toHaveValue('60')
    expect(screen.getByText(formatValidTimeLabel(Date.UTC(2026, 3, 9, 1, 0)) ?? '')).toBeInTheDocument()

    fireEvent.pointerUp(currentSlider)
    expect(mocks.requestTime).toHaveBeenCalledOnce()
    expect(mocks.requestTime).toHaveBeenCalledWith(Date.UTC(2026, 3, 9, 1, 0))
  })

  it('renders selected time without embedded transport controls or status text', () => {
    mocks.timelineState = {
      appliedTimeMs: Date.UTC(2026, 3, 9, 0, 0),
      targetTimeMs: Date.UTC(2026, 3, 9, 0, 30),
      pendingTimeMs: Date.UTC(2026, 3, 9, 0, 45),
      isInFlight: true,
      isPlaying: false,
    }
    render(<TimelineScrubber />)

    expect(screen.getByText(formatValidTimeLabel(Date.UTC(2026, 3, 9, 0, 40)) ?? '')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Step back one hour' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Play forecast timeline' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Step forward one hour' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Previous forecast minute')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Next forecast minute')).not.toBeInTheDocument()
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/queued/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Local Timeline')).not.toBeInTheDocument()
  })

  it('renders labeled major day ticks and minor six-hour scale ticks', () => {
    mocks.forecastHours = ['000', '006', '012', '018', '024', '030', '036', '042', '048']

    const { container } = render(<TimelineScrubber />)
    const majorTicks = container.querySelectorAll('.timeline-scrubber__scale-tick--major')

    expect(container.querySelector('.timeline-scrubber__scale')).not.toBeNull()
    expect(majorTicks.length).toBeGreaterThan(0)
    expect(container.querySelector('.timeline-scrubber__scale-label')?.textContent).toMatch(/\d/)
    expect(container.querySelectorAll('.timeline-scrubber__scale-tick--minor').length).toBeGreaterThan(0)
    expect(container.querySelector('.timeline-scrubber__tick--edge')).toBeNull()
    expect(container.querySelector('.timeline-scrubber__ticks')).toBeNull()
  })
})
