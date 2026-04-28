import { describe, expect, it } from 'vitest'

import {
  createForecastTimeState,
  reduceForecastTimeState,
} from './state'

describe('forecast time state machine', () => {
  it('dispatches immediately when idle and target differs from applied time', () => {
    const state = reduceForecastTimeState(
      createForecastTimeState(0),
      {
        type: 'requestTime',
        timeMs: 60_000,
      }
    )

    expect(state.targetTimeMs).toBe(60_000)
    expect(state.isInFlight).toBe(true)
    expect(state.pendingTimeMs).toBeNull()
  })

  it('replaces the in-flight target for direct time requests', () => {
    const initial = {
      ...createForecastTimeState(0),
      targetTimeMs: 60_000,
      isInFlight: true,
      pendingTimeMs: 120_000,
    }

    const state = reduceForecastTimeState(initial, {
      type: 'requestTime',
      timeMs: 180_000,
    })

    expect(state.targetTimeMs).toBe(180_000)
    expect(state.pendingTimeMs).toBeNull()
    expect(state.isInFlight).toBe(true)
  })

  it('cancels an in-flight target when directly requesting the applied time', () => {
    const initial = {
      ...createForecastTimeState(0),
      targetTimeMs: 60_000,
      isInFlight: true,
      pendingTimeMs: 120_000,
    }

    const state = reduceForecastTimeState(initial, {
      type: 'requestTime',
      timeMs: 0,
    })

    expect(state.targetTimeMs).toBe(0)
    expect(state.pendingTimeMs).toBeNull()
    expect(state.isInFlight).toBe(false)
  })

  it('queues the latest stepped time while a request is in flight', () => {
    const initial = {
      ...createForecastTimeState(0),
      targetTimeMs: 60_000,
      isInFlight: true,
    }

    const state = reduceForecastTimeState(initial, {
      type: 'queueTime',
      timeMs: 120_000,
    })

    expect(state.pendingTimeMs).toBe(120_000)
  })

  it('clears a queued request when the in-flight target is reselected', () => {
    const initial = {
      ...createForecastTimeState(0),
      targetTimeMs: 60_000,
      isInFlight: true,
      pendingTimeMs: 120_000,
    }

    const state = reduceForecastTimeState(initial, {
      type: 'queueTime',
      timeMs: 60_000,
    })

    expect(state.pendingTimeMs).toBeNull()
  })

  it('resets transport state for a new manifest cycle', () => {
    const initial = {
      ...createForecastTimeState(120_000),
      targetTimeMs: 60_000,
      pendingTimeMs: 0,
      isInFlight: true,
      isPlaying: true,
    }

    const state = reduceForecastTimeState(initial, {
      type: 'reset',
      timeMs: 30_000,
      nowMs: 2000,
    })

    expect(state.appliedTimeMs).toBe(30_000)
    expect(state.targetTimeMs).toBe(30_000)
    expect(state.pendingTimeMs).toBeNull()
    expect(state.isInFlight).toBe(false)
    expect(state.isPlaying).toBe(false)
    expect(state.lastAppliedAtMs).toBe(2000)
  })

  it('promotes a queued request as soon as the current request applies', () => {
    const state = reduceForecastTimeState({
      ...createForecastTimeState(60_000),
      pendingTimeMs: 120_000,
      targetTimeMs: 60_000,
      isInFlight: true,
    }, {
      type: 'requestApplied',
      timeMs: 60_000,
      nowMs: 500,
    })

    expect(state.appliedTimeMs).toBe(60_000)
    expect(state.targetTimeMs).toBe(120_000)
    expect(state.pendingTimeMs).toBeNull()
    expect(state.isInFlight).toBe(true)
    expect(state.lastAppliedAtMs).toBe(500)
  })

  it('completes the current request when no queued target remains', () => {
    const state = reduceForecastTimeState({
      ...createForecastTimeState(60_000),
      pendingTimeMs: 120_000,
      targetTimeMs: 120_000,
      isInFlight: true,
    }, {
      type: 'requestApplied',
      timeMs: 120_000,
      nowMs: 500,
    })

    expect(state.appliedTimeMs).toBe(120_000)
    expect(state.targetTimeMs).toBe(120_000)
    expect(state.pendingTimeMs).toBeNull()
    expect(state.isInFlight).toBe(false)
  })
})
