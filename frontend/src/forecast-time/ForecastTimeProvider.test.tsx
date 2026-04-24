import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'

import { createManifestFixture } from '../test/fixtures'
import { useForecastTimeContext, type ForecastTimeContextValue } from './ForecastTimeContext'
import ForecastTimeProvider from './ForecastTimeProvider'
import { validTimeMs } from './time'

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
    expect(getContext().state.targetTimeMs).toBe(0)
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

  it('starts at the current time snapped to the 10-minute timeline grid', () => {
    vi.setSystemTime(new Date('2026-04-09T04:14:00Z'))
    const manifest = createTimelineManifest()

    const { getContext } = renderForecastTimeProvider(manifest)

    expect(getContext().state.appliedTimeMs).toBe(Date.UTC(2026, 3, 9, 4, 10))
    expect(getContext().state.targetTimeMs).toBe(Date.UTC(2026, 3, 9, 4, 10))
  })

  it('coalesces in-flight requests to the latest queued time', () => {
    const manifest = createTimelineManifest()
    const validAt0300 = validTimeMs(manifest.cycle, '003') ?? 0
    const validAt0600 = validTimeMs(manifest.cycle, '006') ?? 0
    const { getContext } = renderForecastTimeProvider(manifest)

    act(() => {
      getContext().controls.requestTime(validAt0300)
    })
    expect(getContext().state.targetTimeMs).toBe(validAt0300)
    expect(getContext().state.isInFlight).toBe(true)

    act(() => {
      getContext().controls.requestTime(validAt0600)
      getContext().controls.requestTime(validAt0300)
      getContext().controls.requestTime(validAt0600)
    })
    expect(getContext().state.pendingTimeMs).toBe(validAt0600)

    act(() => {
      getContext().sync.onRequestApplied(validAt0300)
    })

    expect(getContext().state.targetTimeMs).toBe(validAt0600)
    expect(getContext().state.isInFlight).toBe(true)
  })

  it('resets timeline state when manifest cycle changes', () => {
    vi.setSystemTime(new Date('2026-04-09T04:14:00Z'))

    const manifest = createTimelineManifest({
      generatedAt: '2026-04-09T00:00:00Z',
    })
    const validAt0600 = validTimeMs(manifest.cycle, '006') ?? 0
    const { getContext, rerenderManifest } = renderForecastTimeProvider(manifest)

    act(() => {
      getContext().controls.requestTime(validAt0600)
      getContext().controls.togglePlay()
    })
    expect(getContext().state.targetTimeMs).toBe(validAt0600)
    expect(getContext().state.isPlaying).toBe(true)

    const nextManifest = createTimelineManifest({
      cycle: '2026040912',
      generatedAt: '2026-04-09T12:00:00Z',
    })

    rerenderManifest(nextManifest)

    const resetValidTimeMs = validTimeMs(nextManifest.cycle, '000') ?? 0
    expect(getContext().state.appliedTimeMs).toBe(resetValidTimeMs)
    expect(getContext().state.targetTimeMs).toBe(resetValidTimeMs)
    expect(getContext().state.pendingTimeMs).toBeNull()
    expect(getContext().state.isPlaying).toBe(false)
    expect(getContext().state.isInFlight).toBe(false)
  })

  it('resets to the current snapped timeline step when manifest appears after initial empty state', () => {
    vi.setSystemTime(new Date('2026-04-09T04:14:00Z'))

    const { getContext, rerenderManifest } = renderForecastTimeProvider(null)
    expect(getContext().state.targetTimeMs).toBe(0)

    rerenderManifest(createTimelineManifest())

    expect(getContext().state.appliedTimeMs).toBe(Date.UTC(2026, 3, 9, 4, 10))
    expect(getContext().state.targetTimeMs).toBe(Date.UTC(2026, 3, 9, 4, 10))
  })

  it('steps next from the latest desired 10-minute slot while in flight', () => {
    const manifest = createTimelineManifest()
    const validAt0300 = validTimeMs(manifest.cycle, '003') ?? 0
    const { getContext } = renderForecastTimeProvider(manifest)

    act(() => {
      getContext().controls.requestTime(validAt0300)
    })
    expect(getContext().state.targetTimeMs).toBe(validAt0300)

    act(() => {
      getContext().controls.requestNext()
    })
    expect(getContext().state.pendingTimeMs).toBe(validAt0300 + (10 * 60 * 1000))

    act(() => {
      getContext().controls.requestNext()
    })
    expect(getContext().state.pendingTimeMs).toBe(validAt0300 + (20 * 60 * 1000))
  })

  it('clamps out-of-range frame callback times into the forecast window', () => {
    const manifest = createTimelineManifest()
    const validAtStart = validTimeMs(manifest.cycle, '000') ?? 0
    const validAtEnd = validTimeMs(manifest.cycle, '006') ?? 0
    const { getContext } = renderForecastTimeProvider(manifest)

    act(() => {
      getContext().sync.onRequestStart(Date.UTC(2026, 3, 10, 0, 0))
    })
    expect(getContext().state.targetTimeMs).toBe(validAtEnd)
    expect(getContext().state.isInFlight).toBe(true)

    act(() => {
      getContext().sync.onRequestApplied(Date.UTC(2026, 3, 8, 0, 0))
    })
    expect(getContext().state.appliedTimeMs).toBe(validAtStart)
    expect(getContext().state.targetTimeMs).toBe(validAtStart)
    expect(getContext().state.isInFlight).toBe(false)
  })

  it('advances autoplay by ten forecast minutes after each apply', () => {
    const manifest = createTimelineManifest()
    const validAt0000 = validTimeMs(manifest.cycle, '000') ?? 0
    const validAt0010 = Date.UTC(2026, 3, 9, 0, 10)
    const validAt0020 = Date.UTC(2026, 3, 9, 0, 20)
    const { getContext } = renderForecastTimeProvider(manifest)

    act(() => {
      getContext().controls.togglePlay()
    })
    expect(getContext().state.isPlaying).toBe(true)

    act(() => {
      vi.advanceTimersByTime(99)
    })
    expect(getContext().state.targetTimeMs).toBe(validAt0000)
    expect(getContext().state.isInFlight).toBe(false)

    act(() => {
      vi.advanceTimersByTime(1)
      vi.runOnlyPendingTimers()
    })
    expect(getContext().state.targetTimeMs).toBe(validAt0010)
    expect(getContext().state.isInFlight).toBe(true)

    act(() => {
      getContext().sync.onRequestApplied(validAt0010)
    })
    expect(getContext().state.appliedTimeMs).toBe(validAt0010)
    expect(getContext().state.isInFlight).toBe(false)

    act(() => {
      vi.advanceTimersByTime(99)
    })
    expect(getContext().state.targetTimeMs).toBe(validAt0010)

    act(() => {
      vi.advanceTimersByTime(1)
      vi.runOnlyPendingTimers()
    })
    expect(getContext().state.targetTimeMs).toBe(validAt0020)
  })
})
