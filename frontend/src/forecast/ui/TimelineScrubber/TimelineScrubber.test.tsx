import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  forecastTimeBounds,
  formatValidTimeLabel,
  type ForecastTimelineTime,
} from '@/forecast/time'
import { createForecastTimesFixture } from '@/test/fixtures'
import TimelineScrubber from './TimelineScrubber'

const requestTime = vi.fn()

function createScrubberProps(args: {
  hours?: string[]
  times?: ForecastTimelineTime[]
  requestedTimeMs?: number
  disabled?: boolean
} = {}) {
  const times = args.times ?? createForecastTimesFixture(args.hours ?? ['000', '003', '006'], '2026040900')
  const bounds = forecastTimeBounds(times)
  return {
    times,
    bounds,
    requestedTimeMs: args.requestedTimeMs ?? Date.UTC(2026, 3, 9, 0, 0),
    disabled: args.disabled ?? (times.length <= 1 || bounds == null),
    onRequestTime: requestTime,
  }
}

function renderScrubber(props = createScrubberProps()) {
  return render(<TimelineScrubber {...props} />)
}

function forecastSlider(): HTMLDivElement {
  return screen.getByRole('slider', { name: 'Forecast time' }) as HTMLDivElement
}

function dragSliderBy(deltaX: number, slider = forecastSlider(), startX = 100) {
  fireEvent.pointerDown(slider, { clientX: startX, pointerId: 1 })
  fireEvent.pointerMove(slider, { clientX: startX + deltaX, pointerId: 1 })
  return slider
}

function releaseSliderDrag(deltaX: number, slider = forecastSlider(), startX = 100) {
  fireEvent.pointerUp(slider, { clientX: startX + deltaX, pointerId: 1 })
}

function expectRequestedTime(timeMs: number) {
  expect(requestTime).toHaveBeenCalledWith(timeMs)
}

function validTimeText(timeMs: number): string {
  return formatValidTimeLabel(timeMs) ?? ''
}

function forecastTimesAt(...timeMsValues: number[]): ForecastTimelineTime[] {
  return timeMsValues.map((timeMs, index) => ({
    id: `time-${index}`,
    valid_at: new Date(timeMs).toISOString(),
  }))
}

describe('TimelineScrubber', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders an accessible custom timeline slider', () => {
    renderScrubber()

    const slider = forecastSlider()
    expect(slider).toHaveAttribute('aria-valuemin', '0')
    expect(slider).toHaveAttribute('aria-valuemax', '360')
    expect(slider).toHaveAttribute('aria-valuenow', '0')
    expect(slider).toHaveAttribute('aria-valuetext', validTimeText(Date.UTC(2026, 3, 9, 0, 0)))
  })

  it('renders the selected valid time in the floating badge', () => {
    const firstTimeMs = new Date(2026, 3, 9, 10, 0).getTime()
    const selectedTimeMs = new Date(2026, 3, 9, 11, 0).getTime()
    const times = forecastTimesAt(firstTimeMs, selectedTimeMs)

    renderScrubber(createScrubberProps({
      times,
      requestedTimeMs: selectedTimeMs,
    }))

    expect(screen.getByText(validTimeText(selectedTimeMs))).toBeInTheDocument()
    expect(forecastSlider()).toHaveAttribute('aria-valuetext', validTimeText(selectedTimeMs))
  })

  it('commits ruler drag time only on release, not during drag movement', () => {
    renderScrubber()

    const slider = forecastSlider()
    dragSliderBy(-30, slider)
    expect(slider).toHaveAttribute('aria-valuenow', '30')
    expect(requestTime).not.toHaveBeenCalled()

    releaseSliderDrag(-30, slider)
    expect(requestTime).toHaveBeenCalledOnce()
    expectRequestedTime(Date.UTC(2026, 3, 9, 0, 30))
  })

  it('commits a drag release once when multiple release events fire', () => {
    renderScrubber()

    const slider = dragSliderBy(-30)
    releaseSliderDrag(-30, slider)
    releaseSliderDrag(-30, slider)

    expect(requestTime).toHaveBeenCalledOnce()
    expectRequestedTime(Date.UTC(2026, 3, 9, 0, 30))
  })

  it('does not commit click or tap gestures without meaningful drag movement', () => {
    renderScrubber()

    const slider = forecastSlider()
    fireEvent.pointerDown(slider, { clientX: 100, pointerId: 1 })
    fireEvent.pointerUp(slider, { clientX: 101, pointerId: 1 })

    expect(requestTime).not.toHaveBeenCalled()
  })

  it('preserves an in-progress slider seek across playback frame updates', () => {
    const { rerender } = renderScrubber()

    const slider = dragSliderBy(-30)
    expect(slider).toHaveAttribute('aria-valuetext', validTimeText(Date.UTC(2026, 3, 9, 0, 30)))

    rerender(<TimelineScrubber {...createScrubberProps({
      requestedTimeMs: Date.UTC(2026, 3, 9, 0, 20),
    })}
    />)

    const currentSlider = forecastSlider()
    expect(currentSlider).toBe(slider)
    expect(currentSlider).toHaveAttribute('aria-valuenow', '30')
    expect(currentSlider).toHaveAttribute('aria-valuetext', validTimeText(Date.UTC(2026, 3, 9, 0, 30)))

    releaseSliderDrag(-30, currentSlider)
    expect(requestTime).toHaveBeenCalledOnce()
    expectRequestedTime(Date.UTC(2026, 3, 9, 0, 30))
  })

  it('commits keyboard scrubbing with minute and fast arrow steps', () => {
    renderScrubber()

    const slider = forecastSlider()
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expectRequestedTime(Date.UTC(2026, 3, 9, 0, 1))

    fireEvent.keyDown(slider, { key: 'ArrowRight', shiftKey: true })
    expectRequestedTime(Date.UTC(2026, 3, 9, 0, 15))
  })

  it('cancels an active slider draft on pointer cancel', () => {
    renderScrubber()

    const slider = dragSliderBy(-30)
    expect(slider).toHaveAttribute('aria-valuenow', '30')
    fireEvent.pointerCancel(slider, { pointerId: 1 })

    expect(requestTime).not.toHaveBeenCalled()
    expect(slider).toHaveAttribute('aria-valuenow', '0')
  })

  it('renders compact date labels on the timeline scale', () => {
    const { container } = renderScrubber(createScrubberProps({
      hours: ['000', '006', '012', '018', '024', '030', '036', '042', '048'],
    }))
    const scaleText = container.textContent ?? ''

    expect(scaleText).toMatch(/Apr\s+\d+/)
  })

  it('renders disabled slider state when there is no timeline to scrub', () => {
    renderScrubber(createScrubberProps({ hours: ['000'] }))

    const slider = forecastSlider()
    expect(slider).toHaveAttribute('aria-disabled', 'true')
    expect(slider).toHaveAttribute('tabindex', '-1')
    fireEvent.keyDown(slider, { key: 'ArrowRight' })
    expect(requestTime).not.toHaveBeenCalled()
  })
})
