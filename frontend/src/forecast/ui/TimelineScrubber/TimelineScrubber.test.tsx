import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  formatValidTimeLabel,
  type ForecastTimeContextValue,
} from '@/forecast/time'
import {
  createForecastTimeContextValue,
  createForecastTimesFixture,
} from '@/test/fixtures'
import TimelineScrubber from './TimelineScrubber'

const mocks = vi.hoisted(() => ({
  timeContext: null as ForecastTimeContextValue | null,
  requestTime: vi.fn(),
  togglePlay: vi.fn(),
}))

vi.mock('@/forecast/time', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/forecast/time')>()
  return {
    ...actual,
    useForecastTimeContext: () => mocks.timeContext,
  }
})

function setForecastTimeContext(args: {
  hours?: string[]
  state?: Partial<ForecastTimeContextValue['state']>
} = {}) {
  mocks.timeContext = createForecastTimeContextValue(null, {
    times: createForecastTimesFixture(args.hours ?? ['000', '003', '006'], '2026040900'),
    state: {
      appliedTimeMs: Date.UTC(2026, 3, 9, 0, 0),
      targetTimeMs: Date.UTC(2026, 3, 9, 0, 0),
      pendingTimeMs: null,
      isInFlight: false,
      isPlaying: false,
      ...args.state,
    },
    controls: {
      requestTime: mocks.requestTime,
      togglePlay: mocks.togglePlay,
    },
  })
}

function renderScrubber() {
  return render(<TimelineScrubber />)
}

function forecastSlider(): HTMLInputElement {
  return screen.getByLabelText('Forecast time') as HTMLInputElement
}

function changeSliderTo(value: number, slider = forecastSlider()) {
  fireEvent.change(slider, { target: { value: String(value) } })
}

function dragSliderTo(value: number, slider = forecastSlider()) {
  fireEvent.pointerDown(slider)
  changeSliderTo(value, slider)
  return slider
}

function expectRequestedTime(timeMs: number) {
  expect(mocks.requestTime).toHaveBeenCalledWith(timeMs)
}

function validTimeText(timeMs: number): string {
  return formatValidTimeLabel(timeMs) ?? ''
}

describe('TimelineScrubber', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setForecastTimeContext()
  })

  it('commits slider time only on release, not during drag changes', () => {
    renderScrubber()

    expect(screen.queryByText('Valid Time')).not.toBeInTheDocument()
    expect(screen.queryByText('Ready')).not.toBeInTheDocument()

    const slider = forecastSlider()
    expect(slider).toHaveAttribute('step', '1')
    dragSliderTo(30, slider)
    expect(mocks.requestTime).not.toHaveBeenCalled()

    fireEvent.pointerUp(slider)
    expect(mocks.requestTime).toHaveBeenCalledOnce()
    expectRequestedTime(Date.UTC(2026, 3, 9, 0, 30))
  })

  it('commits a drag release once when multiple release events fire', () => {
    renderScrubber()

    const slider = dragSliderTo(30)
    fireEvent.pointerUp(slider)
    fireEvent.mouseUp(slider)
    fireEvent.touchEnd(slider)

    expect(mocks.requestTime).toHaveBeenCalledOnce()
    expectRequestedTime(Date.UTC(2026, 3, 9, 0, 30))
  })

  it('commits non-drag slider changes immediately', () => {
    renderScrubber()

    changeSliderTo(30)

    expect(mocks.requestTime).toHaveBeenCalledOnce()
    expectRequestedTime(Date.UTC(2026, 3, 9, 0, 30))
  })

  it('preserves an in-progress slider seek across playback frame updates', () => {
    setForecastTimeContext({
      state: {
        appliedTimeMs: Date.UTC(2026, 3, 9, 0, 0),
        targetTimeMs: Date.UTC(2026, 3, 9, 0, 10),
        pendingTimeMs: null,
        isInFlight: true,
        isPlaying: true,
      },
    })
    const { rerender } = renderScrubber()

    const slider = dragSliderTo(60)
    expect(screen.getByText(validTimeText(Date.UTC(2026, 3, 9, 1, 0)))).toBeInTheDocument()

    setForecastTimeContext({
      state: {
        appliedTimeMs: Date.UTC(2026, 3, 9, 0, 10),
        targetTimeMs: Date.UTC(2026, 3, 9, 0, 20),
        isInFlight: true,
        isPlaying: true,
      },
    })
    rerender(<TimelineScrubber />)

    const currentSlider = forecastSlider()
    expect(currentSlider).toBe(slider)
    expect(currentSlider).toHaveValue('60')
    expect(screen.getByText(validTimeText(Date.UTC(2026, 3, 9, 1, 0)))).toBeInTheDocument()

    fireEvent.pointerUp(currentSlider)
    expect(mocks.requestTime).toHaveBeenCalledOnce()
    expectRequestedTime(Date.UTC(2026, 3, 9, 1, 0))
  })

  it('commits an active slider draft on blur', () => {
    renderScrubber()

    const slider = dragSliderTo(30)
    fireEvent.blur(slider)

    expect(mocks.requestTime).toHaveBeenCalledOnce()
    expectRequestedTime(Date.UTC(2026, 3, 9, 0, 30))
  })

  it('cancels an active slider draft on pointer cancel', () => {
    renderScrubber()

    const slider = dragSliderTo(30)
    fireEvent.pointerCancel(slider)
    fireEvent.pointerUp(slider)

    expect(mocks.requestTime).not.toHaveBeenCalled()
    expect(slider).toHaveValue('0')
  })

  it('renders selected time without embedded transport controls or status text', () => {
    setForecastTimeContext({
      state: {
        appliedTimeMs: Date.UTC(2026, 3, 9, 0, 0),
        targetTimeMs: Date.UTC(2026, 3, 9, 0, 30),
        pendingTimeMs: Date.UTC(2026, 3, 9, 0, 45),
        isInFlight: true,
        isPlaying: false,
      },
    })
    renderScrubber()

    expect(screen.getByText(validTimeText(Date.UTC(2026, 3, 9, 0, 45)))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Step back one minute' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Play forecast timeline' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Step forward one minute' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Previous forecast minute')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Next forecast minute')).not.toBeInTheDocument()
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/queued/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Local Timeline')).not.toBeInTheDocument()
  })

  it('renders labeled major day ticks and minor two-hour scale ticks', () => {
    setForecastTimeContext({
      hours: ['000', '006', '012', '018', '024', '030', '036', '042', '048'],
    })

    const { container } = renderScrubber()
    const majorTicks = container.querySelectorAll('.timeline-scrubber__scale-tick--major')
    const minorTicks = container.querySelectorAll('.timeline-scrubber__scale-tick--minor')

    expect(container.querySelector('.timeline-scrubber__scale')).not.toBeNull()
    expect(majorTicks.length).toBeGreaterThan(0)
    expect(container.querySelector('.timeline-scrubber__scale-label')?.textContent).toMatch(/\d/)
    expect(minorTicks.length).toBeGreaterThanOrEqual(20)
    expect(container.querySelector('.timeline-scrubber__tick--edge')).toBeNull()
    expect(container.querySelector('.timeline-scrubber__ticks')).toBeNull()
  })
})
