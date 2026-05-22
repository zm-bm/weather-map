import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { formatValidTimeLabel } from '../../forecast-time'
import TimelineScrubber from './TimelineScrubber'

const mocks = vi.hoisted(() => ({
  createTimes: (hours: string[]) => hours.map((id) => ({
    id,
    validAt: new Date(Date.UTC(2026, 3, 9, Number.parseInt(id, 10))).toISOString(),
  })),
  times: [] as Array<{ id: string, validAt: string }>,
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
      times: mocks.times,
      state: mocks.timelineState,
      controls: {
        requestNext: vi.fn(),
        requestPrev: vi.fn(),
        requestTime: mocks.requestTime,
        togglePlay: mocks.togglePlay,
      },
      syncCallbacks: {
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
    mocks.times = mocks.createTimes(['000', '003', '006'])
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

  it('commits a drag release once when multiple release events fire', () => {
    render(<TimelineScrubber />)

    const slider = screen.getByLabelText('Forecast time')
    fireEvent.pointerDown(slider)
    fireEvent.change(slider, { target: { value: '30' } })
    fireEvent.pointerUp(slider)
    fireEvent.mouseUp(slider)
    fireEvent.touchEnd(slider)

    expect(mocks.requestTime).toHaveBeenCalledOnce()
    expect(mocks.requestTime).toHaveBeenCalledWith(Date.UTC(2026, 3, 9, 0, 30))
  })

  it('commits non-drag slider changes immediately', () => {
    render(<TimelineScrubber />)

    const slider = screen.getByLabelText('Forecast time')
    fireEvent.change(slider, { target: { value: '30' } })

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

  it('commits an active slider draft on blur', () => {
    render(<TimelineScrubber />)

    const slider = screen.getByLabelText('Forecast time')
    fireEvent.pointerDown(slider)
    fireEvent.change(slider, { target: { value: '30' } })
    fireEvent.blur(slider)

    expect(mocks.requestTime).toHaveBeenCalledOnce()
    expect(mocks.requestTime).toHaveBeenCalledWith(Date.UTC(2026, 3, 9, 0, 30))
  })

  it('cancels an active slider draft on pointer cancel', () => {
    render(<TimelineScrubber />)

    const slider = screen.getByLabelText('Forecast time')
    fireEvent.pointerDown(slider)
    fireEvent.change(slider, { target: { value: '30' } })
    fireEvent.pointerCancel(slider)
    fireEvent.pointerUp(slider)

    expect(mocks.requestTime).not.toHaveBeenCalled()
    expect(slider).toHaveValue('0')
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
    expect(screen.queryByRole('button', { name: 'Step back ten minutes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Play forecast timeline' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Step forward ten minutes' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Previous forecast minute')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Next forecast minute')).not.toBeInTheDocument()
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/queued/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Local Timeline')).not.toBeInTheDocument()
  })

  it('renders labeled major day ticks and minor six-hour scale ticks', () => {
    mocks.times = mocks.createTimes(['000', '006', '012', '018', '024', '030', '036', '042', '048'])

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
