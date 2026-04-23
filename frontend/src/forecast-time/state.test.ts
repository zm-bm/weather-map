import { describe, expect, it } from 'vitest'

import {
  hourTokenAt,
  nextHourIndex,
  normalizeHourIndex,
  prevHourIndex,
} from './time'
import {
  createForecastTimeState,
  reduceForecastTimeState,
} from './state'

describe('forecast time state machine', () => {
  it('normalizes and wraps hour indexes for timeline navigation', () => {
    expect(normalizeHourIndex(-1, 3)).toBe(0)
    expect(normalizeHourIndex(99, 3)).toBe(2)
    expect(nextHourIndex(2, 3)).toBe(0)
    expect(prevHourIndex(0, 3)).toBe(2)
    expect(normalizeHourIndex(7, 0)).toBe(0)
    expect(nextHourIndex(0, 0)).toBe(0)
    expect(prevHourIndex(0, 0)).toBe(0)
  })

  it('resolves hour tokens with safe fallback for empty manifests', () => {
    expect(hourTokenAt(['000', '003', '006'], 1)).toBe('003')
    expect(hourTokenAt(['000', '003', '006'], 99)).toBe('006')
    expect(hourTokenAt([], 0)).toBe('000')
  })

  it('dispatches immediately when not debounced and not in flight', () => {
    const state = reduceForecastTimeState(
      createForecastTimeState(0),
      {
        type: 'requestHour',
        hourIndex: 1,
        nowMs: 1000,
        debounceMs: 250,
      }
    )

    expect(state.targetHourIndex).toBe(1)
    expect(state.isInFlight).toBe(true)
    expect(state.pendingHourIndex).toBeNull()
    expect(state.pendingRetryAtMs).toBeNull()
  })

  it('queues request during debounce window', () => {
    const initial = {
      ...createForecastTimeState(0),
      targetHourIndex: 1,
      lastDispatchAtMs: 1000,
    }

    const state = reduceForecastTimeState(initial, {
      type: 'requestHour',
      hourIndex: 2,
      nowMs: 1100,
      debounceMs: 250,
    })

    expect(state.pendingHourIndex).toBe(2)
    expect(state.pendingRetryAtMs).toBe(1250)
  })

  it('coalesces to queue when in flight and target differs from requested', () => {
    const initial = {
      ...createForecastTimeState(0),
      targetHourIndex: 1,
      isInFlight: true,
    }

    const state = reduceForecastTimeState(initial, {
      type: 'requestHour',
      hourIndex: 2,
      nowMs: 2000,
      debounceMs: 250,
    })

    expect(state.pendingHourIndex).toBe(2)
    expect(state.pendingRetryAtMs).toBeNull()
  })

  it('resets transport state for a new manifest cycle', () => {
    const initial = {
      ...createForecastTimeState(2),
      targetHourIndex: 1,
      pendingHourIndex: 0,
      pendingRetryAtMs: 1234,
      isInFlight: true,
      isPlaying: true,
      lastDispatchAtMs: 500,
    }

    const state = reduceForecastTimeState(initial, {
      type: 'reset',
      hourIndex: 0,
      nowMs: 2000,
    })

    expect(state.appliedHourIndex).toBe(0)
    expect(state.targetHourIndex).toBe(0)
    expect(state.pendingHourIndex).toBeNull()
    expect(state.pendingRetryAtMs).toBeNull()
    expect(state.isInFlight).toBe(false)
    expect(state.isPlaying).toBe(false)
    expect(state.lastDispatchAtMs).toBe(0)
    expect(state.lastAppliedAtMs).toBe(2000)
  })

  it('dispatches queued hour only when debounce elapsed and no in-flight request', () => {
    const readyState = {
      ...createForecastTimeState(1),
      pendingHourIndex: 2,
      lastDispatchAtMs: 0,
    }
    const dispatched = reduceForecastTimeState(readyState, {
      type: 'flushPending',
      nowMs: 500,
      debounceMs: 250,
    })
    expect(dispatched.targetHourIndex).toBe(2)
    expect(dispatched.isInFlight).toBe(true)
    expect(dispatched.pendingHourIndex).toBeNull()
    expect(dispatched.pendingRetryAtMs).toBeNull()

    const waitingState = {
      ...createForecastTimeState(1),
      pendingHourIndex: 2,
      lastDispatchAtMs: 400,
    }
    const queued = reduceForecastTimeState(waitingState, {
      type: 'flushPending',
      nowMs: 500,
      debounceMs: 250,
    })
    expect(queued.pendingHourIndex).toBe(2)
    expect(queued.pendingRetryAtMs).toBe(650)
  })
})
