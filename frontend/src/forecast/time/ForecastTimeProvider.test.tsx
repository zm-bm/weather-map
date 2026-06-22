import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'

import {
  createActiveRunFixture,
  createManifestFixture,
  type ManifestFixtureOverrides,
} from '@/test/fixtures'
import { useForecastTimeContext, type ForecastTimeContextValue } from './ForecastTimeContext'
import ForecastTimeProvider from './ForecastTimeProvider'
import { DEFAULT_PLAY_MIN_INTERVAL_MS } from './state'

const DEFAULT_FRAME_IDS = ['000', '003', '006']
const OBSERVED_FRAME_SPECS = [
  {
    id: '20260611000238',
    lead_hours: 0,
    valid_at: '2026-06-11T00:02:38Z',
  },
  {
    id: '20260611000440',
    lead_hours: 0,
    valid_at: '2026-06-11T00:04:40Z',
  },
  {
    id: '20260611005839',
    lead_hours: 0,
    valid_at: '2026-06-11T00:58:39Z',
  },
]

function createTimelineManifest(
  overrides: ManifestFixtureOverrides = {}
) {
  return createManifestFixture({
    cycle: '2026040900',
    frameIds: DEFAULT_FRAME_IDS,
    ...overrides,
  })
}

function validTimeFor(manifest: ReturnType<typeof createManifestFixture>, hourId: string): number {
  const time = createActiveRunFixture(manifest).latest.frames.find((entry) => entry.id === hourId)
  if (!time) throw new Error(`Missing fixture time ${hourId}`)
  return Date.parse(time.valid_at)
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
        <div data-testid="times">{context.times.map((time) => time.id).join(',')}</div>
      </div>
    )
  }

  const ui = (manifest: ReturnType<typeof createManifestFixture> | null) => {
    const activeRun = manifest ? createActiveRunFixture(manifest) : null
    return (
      <ForecastTimeProvider activeRun={activeRun}>
        <Probe />
      </ForecastTimeProvider>
    )
  }

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

    expect(screen.getByTestId('times')).toHaveTextContent('')
    expect(getContext().state.targetTimeMs).toBe(0)
    expect(typeof getContext().syncCallbacks.onRequestStart).toBe('function')
    expect(typeof getContext().syncCallbacks.onRequestApplied).toBe('function')
    expect(typeof getContext().syncCallbacks.onRequestError).toBe('function')
  })

  it('forwards manifest times to context value', () => {
    const manifest = createTimelineManifest()

    renderForecastTimeProvider(manifest)

    expect(screen.getByTestId('times')).toHaveTextContent('000,003,006')
  })

  it('starts at the current time snapped to the minute timeline grid', () => {
    vi.setSystemTime(new Date('2026-04-09T04:14:00Z'))
    const manifest = createTimelineManifest()

    const { getContext } = renderForecastTimeProvider(manifest)

    expect(getContext().state.appliedTimeMs).toBe(Date.UTC(2026, 3, 9, 4, 14))
    expect(getContext().state.targetTimeMs).toBe(Date.UTC(2026, 3, 9, 4, 14))
  })

  it('replaces in-flight requests so direct timeline seeks win', () => {
    const manifest = createTimelineManifest()
    const validAt0300 = validTimeFor(manifest, '003')
    const validAt0600 = validTimeFor(manifest, '006')
    const { getContext } = renderForecastTimeProvider(manifest)

    act(() => {
      getContext().controls.requestTime(validAt0300)
    })
    expect(getContext().state.targetTimeMs).toBe(validAt0300)
    expect(getContext().state.isInFlight).toBe(true)

    act(() => {
      getContext().controls.requestTime(validAt0600)
    })
    expect(getContext().state.targetTimeMs).toBe(validAt0600)
    expect(getContext().state.pendingTimeMs).toBeNull()
    expect(getContext().state.isInFlight).toBe(true)
  })

  it('resets timeline state when manifest cycle changes', () => {
    vi.setSystemTime(new Date('2026-04-09T04:14:00Z'))

    const manifest = createTimelineManifest({
      generated_at: '2026-04-09T00:00:00Z',
    })
    const validAt0600 = validTimeFor(manifest, '006')
    const { getContext, rerenderManifest } = renderForecastTimeProvider(manifest)

    act(() => {
      getContext().controls.requestTime(validAt0600)
      getContext().controls.togglePlay()
    })
    expect(getContext().state.targetTimeMs).toBe(validAt0600)
    expect(getContext().state.isPlaying).toBe(true)

    const nextManifest = createTimelineManifest({
      cycle: '2026040912',
      generated_at: '2026-04-09T12:00:00Z',
    })

    rerenderManifest(nextManifest)

    const resetValidTimeMs = validTimeFor(nextManifest, '000')
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

    expect(getContext().state.appliedTimeMs).toBe(Date.UTC(2026, 3, 9, 4, 14))
    expect(getContext().state.targetTimeMs).toBe(Date.UTC(2026, 3, 9, 4, 14))
  })

  it('resets to now from an arbitrary timeline selection', () => {
    const manifest = createTimelineManifest()
    const validAt0600 = validTimeFor(manifest, '006')
    const { getContext } = renderForecastTimeProvider(manifest)

    act(() => {
      getContext().controls.requestTime(validAt0600)
      getContext().controls.togglePlay()
    })
    expect(getContext().state.targetTimeMs).toBe(validAt0600)
    expect(getContext().state.isPlaying).toBe(true)

    vi.setSystemTime(new Date('2026-04-09T02:12:00Z'))
    act(() => {
      getContext().controls.resetToNow()
    })

    expect(getContext().state.appliedTimeMs).toBe(Date.UTC(2026, 3, 9, 2, 12))
    expect(getContext().state.targetTimeMs).toBe(Date.UTC(2026, 3, 9, 2, 12))
    expect(getContext().state.pendingTimeMs).toBeNull()
    expect(getContext().state.isPlaying).toBe(false)
    expect(getContext().state.isInFlight).toBe(false)
  })

  it('clamps out-of-range frame callback times into the forecast window', () => {
    const manifest = createTimelineManifest()
    const validAtStart = validTimeFor(manifest, '000')
    const validAtEnd = validTimeFor(manifest, '006')
    const { getContext } = renderForecastTimeProvider(manifest)

    act(() => {
      getContext().syncCallbacks.onRequestStart(Date.UTC(2026, 3, 10, 0, 0))
    })
    expect(getContext().state.targetTimeMs).toBe(validAtEnd)
    expect(getContext().state.isInFlight).toBe(true)

    act(() => {
      getContext().syncCallbacks.onRequestApplied(Date.UTC(2026, 3, 8, 0, 0))
    })
    expect(getContext().state.appliedTimeMs).toBe(validAtStart)
    expect(getContext().state.targetTimeMs).toBe(validAtStart)
    expect(getContext().state.isInFlight).toBe(false)
  })

  it('advances autoplay by one forecast minute after each apply', () => {
    const manifest = createTimelineManifest()
    const validAt0000 = validTimeFor(manifest, '000')
    const validAt0001 = Date.UTC(2026, 3, 9, 0, 1)
    const validAt0002 = Date.UTC(2026, 3, 9, 0, 2)
    const { getContext } = renderForecastTimeProvider(manifest)

    act(() => {
      getContext().controls.togglePlay()
    })
    expect(getContext().state.isPlaying).toBe(true)

    act(() => {
      vi.advanceTimersByTime(DEFAULT_PLAY_MIN_INTERVAL_MS - 1)
    })
    expect(getContext().state.targetTimeMs).toBe(validAt0000)
    expect(getContext().state.isInFlight).toBe(false)

    act(() => {
      vi.advanceTimersByTime(1)
      vi.runOnlyPendingTimers()
    })
    expect(getContext().state.targetTimeMs).toBe(validAt0001)
    expect(getContext().state.isInFlight).toBe(true)

    act(() => {
      getContext().syncCallbacks.onRequestApplied(validAt0001)
    })
    expect(getContext().state.appliedTimeMs).toBe(validAt0001)
    expect(getContext().state.isInFlight).toBe(false)

    act(() => {
      vi.advanceTimersByTime(DEFAULT_PLAY_MIN_INTERVAL_MS - 1)
    })
    expect(getContext().state.targetTimeMs).toBe(validAt0001)

    act(() => {
      vi.advanceTimersByTime(1)
      vi.runOnlyPendingTimers()
    })
    expect(getContext().state.targetTimeMs).toBe(validAt0002)
  })

  it('wraps autoplay from a non-minute-aligned observed range end', () => {
    vi.setSystemTime(new Date('2026-06-11T01:00:00Z'))
    const manifest = createTimelineManifest({
      frames: OBSERVED_FRAME_SPECS,
    })
    const validAtStart = Date.UTC(2026, 5, 11, 0, 2, 38)
    const validAtEnd = Date.UTC(2026, 5, 11, 0, 58, 39)
    const { getContext } = renderForecastTimeProvider(manifest)

    expect(getContext().state.appliedTimeMs).toBe(validAtEnd)
    expect(getContext().state.targetTimeMs).toBe(validAtEnd)

    act(() => {
      getContext().controls.togglePlay()
    })

    act(() => {
      vi.advanceTimersByTime(DEFAULT_PLAY_MIN_INTERVAL_MS)
      vi.runOnlyPendingTimers()
    })

    expect(getContext().state.targetTimeMs).toBe(validAtStart)
    expect(getContext().state.isInFlight).toBe(true)
  })

  it('lets a manual seek win over a scheduled playback tick', () => {
    const manifest = createTimelineManifest()
    const validAt0300 = validTimeFor(manifest, '003')
    const { getContext } = renderForecastTimeProvider(manifest)

    act(() => {
      getContext().controls.togglePlay()
    })
    expect(getContext().state.isPlaying).toBe(true)

    act(() => {
      getContext().controls.requestTime(validAt0300)
      vi.runOnlyPendingTimers()
    })

    expect(getContext().state.targetTimeMs).toBe(validAt0300)
    expect(getContext().state.isInFlight).toBe(true)
  })

  it('keeps playback ticking after a same-time seek', () => {
    const manifest = createTimelineManifest()
    const validAt0000 = validTimeFor(manifest, '000')
    const validAt0001 = Date.UTC(2026, 3, 9, 0, 1)
    const { getContext } = renderForecastTimeProvider(manifest)

    act(() => {
      getContext().controls.togglePlay()
    })
    expect(getContext().state.isPlaying).toBe(true)
    expect(getContext().state.targetTimeMs).toBe(validAt0000)

    act(() => {
      getContext().controls.requestTime(validAt0000)
      vi.advanceTimersByTime(DEFAULT_PLAY_MIN_INTERVAL_MS)
    })

    expect(getContext().state.isPlaying).toBe(true)
    expect(getContext().state.targetTimeMs).toBe(validAt0001)
    expect(getContext().state.appliedTimeMs).toBe(validAt0000)
    expect(getContext().state.isInFlight).toBe(true)
  })
})
