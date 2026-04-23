import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'

import { createManifestFixture } from '../test/fixtures'
import { useForecastTimeContext, type ForecastTimeContextValue } from './ForecastTimeContext'
import ForecastTimeProvider from './ForecastTimeProvider'

const DEFAULT_FORECAST_HOURS = ['000', '003', '006']

function createTimelineManifest(
  overrides: Partial<Pick<ReturnType<typeof createManifestFixture>, 'cycle' | 'generatedAt' | 'forecastHours'>> = {}
) {
  return createManifestFixture({
    cycle: '2026040900',
    forecastHours: DEFAULT_FORECAST_HOURS,
    ...overrides,
  })
}

function forecastTimeProviderKey(manifest: ReturnType<typeof createManifestFixture> | null): string {
  if (manifest == null) return 'forecast-time:none'
  return `forecast-time:${manifest.cycle}:${manifest.forecastHours.join(',')}`
}

function renderForecastTimeProvider(initialManifest: ReturnType<typeof createManifestFixture> | null) {
  const contextRef: { current: ForecastTimeContextValue | null } = { current: null }

  function Probe() {
    const context = useForecastTimeContext()
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
    <ForecastTimeProvider key={forecastTimeProviderKey(manifest)} manifest={manifest}>
      <Probe />
    </ForecastTimeProvider>
  )

  const renderResult = render(ui(initialManifest))

  const getContext = () => {
    if (!contextRef.current) {
      throw new Error('Expected ForecastTimeContext value to be available.')
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

describe('ForecastTimeProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('provides empty manifest defaults when manifest is unavailable', () => {
    const { getContext } = renderForecastTimeProvider(null)

    expect(screen.getByTestId('cycle')).toHaveTextContent('none')
    expect(screen.getByTestId('hours')).toHaveTextContent('')
    expect(getContext().state.targetHourIndex).toBe(0)
    expect(typeof getContext().sync.onRequestStart).toBe('function')
    expect(typeof getContext().sync.onRequestApplied).toBe('function')
    expect(typeof getContext().sync.onRequestError).toBe('function')
  })

  it('forwards manifest cycle and forecast hours to context value', () => {
    const manifest = createTimelineManifest()

    renderForecastTimeProvider(manifest)

    expect(screen.getByTestId('cycle')).toHaveTextContent('2026040900')
    expect(screen.getByTestId('hours')).toHaveTextContent('000,003,006')
  })

  it('starts at the hour closest to current time', () => {
    vi.setSystemTime(new Date('2026-04-09T04:10:00Z'))
    const manifest = createTimelineManifest()

    const { getContext } = renderForecastTimeProvider(manifest)

    expect(getContext().state.appliedHourIndex).toBe(1)
    expect(getContext().state.targetHourIndex).toBe(1)
  })

  it('coalesces in-flight requests to latest queued hour', () => {
    const manifest = createTimelineManifest()
    const { getContext } = renderForecastTimeProvider(manifest)

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
      getContext().sync.onRequestApplied(1)
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

    const manifest = createTimelineManifest({
      generatedAt: '2026-04-09T00:00:00Z',
    })
    const { getContext, rerenderManifest } = renderForecastTimeProvider(manifest)

    act(() => {
      getContext().controls.requestHour(2)
      getContext().controls.togglePlay()
    })
    expect(getContext().state.targetHourIndex).toBe(2)
    expect(getContext().state.isPlaying).toBe(true)

    const nextManifest = createTimelineManifest({
      cycle: '2026040912',
      generatedAt: '2026-04-09T12:00:00Z',
    })

    rerenderManifest(nextManifest)

    expect(getContext().state.appliedHourIndex).toBe(0)
    expect(getContext().state.targetHourIndex).toBe(0)
    expect(getContext().state.pendingHourIndex).toBeNull()
    expect(getContext().state.isPlaying).toBe(false)
    expect(getContext().state.isInFlight).toBe(false)
  })

  it('resets to closest hour when manifest appears after initial empty state', () => {
    vi.setSystemTime(new Date('2026-04-09T04:10:00Z'))

    const { getContext, rerenderManifest } = renderForecastTimeProvider(null)
    expect(getContext().state.targetHourIndex).toBe(0)

    rerenderManifest(createTimelineManifest())

    expect(getContext().state.appliedHourIndex).toBe(1)
    expect(getContext().state.targetHourIndex).toBe(1)
  })

  it('steps next from latest desired hour while in flight', () => {
    const manifest = createTimelineManifest()
    const { getContext } = renderForecastTimeProvider(manifest)

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
    const manifest = createTimelineManifest()
    const { getContext } = renderForecastTimeProvider(manifest)

    act(() => {
      getContext().sync.onRequestStart(99)
    })
    expect(getContext().state.targetHourIndex).toBe(2)
    expect(getContext().state.isInFlight).toBe(true)

    act(() => {
      getContext().sync.onRequestApplied(-9)
    })
    expect(getContext().state.appliedHourIndex).toBe(0)
    expect(getContext().state.targetHourIndex).toBe(0)
    expect(getContext().state.isInFlight).toBe(false)
  })

  it('advances autoplay only after apply plus the minimum interval', () => {
    const manifest = createTimelineManifest()
    const { getContext } = renderForecastTimeProvider(manifest)

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
      getContext().sync.onRequestApplied(1)
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
  })
})
