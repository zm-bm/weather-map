import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'

import { createManifestFixture } from '../test/fixtures'
import { useTimelineContext, type TimelineContextValue } from './TimelineContext'
import TimelineProvider from './TimelineProvider'

const DEFAULT_FORECAST_HOURS = ['000', '003', '006']

function renderTimelineProvider(initialManifest: ReturnType<typeof createManifestFixture> | null) {
  const contextRef: { current: TimelineContextValue | null } = { current: null }

  function Probe() {
    const context = useTimelineContext()
    useEffect(() => {
      contextRef.current = context
    }, [context])

    return (
      <div>
        <div data-testid="cycle">{context.cycle ?? 'none'}</div>
        <div data-testid="hours">{context.forecastHours.join(',')}</div>
      </div>
    )
  }

  const ui = (manifest: ReturnType<typeof createManifestFixture> | null) => (
    <TimelineProvider manifest={manifest}>
      <Probe />
    </TimelineProvider>
  )

  const renderResult = render(ui(initialManifest))

  const getContext = () => {
    if (!contextRef.current) {
      throw new Error('Expected TimelineContext value to be available.')
    }
    return contextRef.current
  }

  return {
    ...renderResult,
    rerenderManifest: (manifest: ReturnType<typeof createManifestFixture> | null) => {
      renderResult.rerender(ui(manifest))
    },
    getContext,
  }
}

describe('TimelineProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('provides empty manifest defaults when manifest is unavailable', () => {
    const { getContext } = renderTimelineProvider(null)

    expect(screen.getByTestId('cycle')).toHaveTextContent('none')
    expect(screen.getByTestId('hours')).toHaveTextContent('')
    expect(getContext().state.targetHourIndex).toBe(0)
    expect(typeof getContext().sync.onRequestStart).toBe('function')
    expect(typeof getContext().sync.onRequestApplied).toBe('function')
    expect(typeof getContext().sync.onRequestError).toBe('function')
  })

  it('forwards manifest cycle and forecast hours to context value', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: DEFAULT_FORECAST_HOURS,
    })

    renderTimelineProvider(manifest)

    expect(screen.getByTestId('cycle')).toHaveTextContent('2026040900')
    expect(screen.getByTestId('hours')).toHaveTextContent('000,003,006')
  })

  it('starts at the hour closest to current time', () => {
    vi.setSystemTime(new Date('2026-04-09T04:10:00Z'))
    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: DEFAULT_FORECAST_HOURS,
    })

    const { getContext } = renderTimelineProvider(manifest)

    expect(getContext().state.appliedHourIndex).toBe(1)
    expect(getContext().state.targetHourIndex).toBe(1)
  })

  it('coalesces in-flight requests to latest queued hour', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: DEFAULT_FORECAST_HOURS,
    })
    const { getContext } = renderTimelineProvider(manifest)

    act(() => {
      getContext().controls.requestHour(1)
    })
    expect(getContext().state.targetHourIndex).toBe(1)
    expect(getContext().state.isInFlight).toBe(true)

    act(() => {
      getContext().controls.requestHour(2)
      getContext().controls.requestHour(1)
      getContext().controls.requestHour(2)
    })
    expect(getContext().state.pendingHourIndex).toBe(2)

    act(() => {
      getContext().sync.onRequestApplied?.(1)
    })

    act(() => {
      vi.advanceTimersByTime(300)
      vi.runOnlyPendingTimers()
    })

    expect(getContext().state.targetHourIndex).toBe(2)
    expect(getContext().state.isInFlight).toBe(true)
  })

  it('resets timeline state when manifest cycle changes', () => {
    vi.setSystemTime(new Date('2026-04-09T04:10:00Z'))

    const manifest = createManifestFixture({
      cycle: '2026040900',
      generatedAt: '2026-04-09T00:00:00Z',
      forecastHours: DEFAULT_FORECAST_HOURS,
    })
    const { getContext, rerenderManifest } = renderTimelineProvider(manifest)

    act(() => {
      getContext().controls.requestHour(2)
      getContext().controls.togglePlay()
    })
    expect(getContext().state.targetHourIndex).toBe(2)
    expect(getContext().state.isPlaying).toBe(true)

    const nextManifest = createManifestFixture({
      cycle: '2026040912',
      generatedAt: '2026-04-09T12:00:00Z',
      forecastHours: DEFAULT_FORECAST_HOURS,
    })

    rerenderManifest(nextManifest)

    expect(getContext().state.appliedHourIndex).toBe(0)
    expect(getContext().state.targetHourIndex).toBe(0)
    expect(getContext().state.pendingHourIndex).toBeNull()
    expect(getContext().state.isPlaying).toBe(false)
    expect(getContext().state.isInFlight).toBe(false)
  })

  it('steps next from latest desired hour while in flight', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: DEFAULT_FORECAST_HOURS,
    })
    const { getContext } = renderTimelineProvider(manifest)

    act(() => {
      getContext().controls.requestHour(1)
    })
    expect(getContext().state.targetHourIndex).toBe(1)

    act(() => {
      getContext().controls.requestNext()
    })
    expect(getContext().state.pendingHourIndex).toBe(2)

    act(() => {
      getContext().controls.requestNext()
    })
    expect(getContext().state.pendingHourIndex).toBe(0)
  })

  it('normalizes out-of-range frame callback hour indexes', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: DEFAULT_FORECAST_HOURS,
    })
    const { getContext } = renderTimelineProvider(manifest)

    act(() => {
      getContext().sync.onRequestStart?.(99)
    })
    expect(getContext().state.targetHourIndex).toBe(2)
    expect(getContext().state.isInFlight).toBe(true)

    act(() => {
      getContext().sync.onRequestApplied?.(-9)
    })
    expect(getContext().state.appliedHourIndex).toBe(0)
    expect(getContext().state.targetHourIndex).toBe(0)
    expect(getContext().state.isInFlight).toBe(false)
  })

  it('advances autoplay only after apply plus the minimum interval', () => {
    const manifest = createManifestFixture({
      cycle: '2026040900',
      forecastHours: DEFAULT_FORECAST_HOURS,
    })
    const { getContext } = renderTimelineProvider(manifest)

    act(() => {
      getContext().controls.togglePlay()
    })
    expect(getContext().state.isPlaying).toBe(true)

    act(() => {
      vi.advanceTimersByTime(999)
    })
    expect(getContext().state.targetHourIndex).toBe(0)
    expect(getContext().state.isInFlight).toBe(false)

    act(() => {
      vi.advanceTimersByTime(1)
      vi.runOnlyPendingTimers()
    })
    expect(getContext().state.targetHourIndex).toBe(1)
    expect(getContext().state.isInFlight).toBe(true)

    act(() => {
      getContext().sync.onRequestApplied?.(1)
    })
    expect(getContext().state.appliedHourIndex).toBe(1)
    expect(getContext().state.isInFlight).toBe(false)

    act(() => {
      vi.advanceTimersByTime(999)
    })
    expect(getContext().state.targetHourIndex).toBe(1)

    act(() => {
      vi.advanceTimersByTime(1)
      vi.runOnlyPendingTimers()
    })
    expect(getContext().state.targetHourIndex).toBe(2)
    expect(getContext().state.isInFlight).toBe(true)
  })
})
