import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createConfigFixture,
  createForecastDataTargetFixture,
} from '@/test/fixtures'
import type { ForecastDataSession, ForecastDataTarget } from '@/forecast/data'
import { useDataPrefetch } from './useDataPrefetch'

const mocks = vi.hoisted(() => ({
  prefetch: vi.fn(),
}))

const DEFAULT_DATA_OPTIONS = {
  pressure: true,
  windVectors: true,
}

function createTarget(overrides: Partial<ForecastDataTarget> = {}): ForecastDataTarget {
  return createForecastDataTargetFixture({
    interpolationWindow: {
      selectedValidTimeMs: Date.UTC(2026, 3, 13, 15),
      lowerHourToken: '000',
      upperHourToken: '003',
      lowerValidTimeMs: Date.UTC(2026, 3, 13, 12),
      upperValidTimeMs: Date.UTC(2026, 3, 13, 15),
      mix: 0.5,
    },
    overrides,
  })
}

function createDataSession(): ForecastDataSession {
  return {
    createLoadJob: vi.fn(),
    prefetch: mocks.prefetch,
    reset: vi.fn(),
  }
}

describe('useDataPrefetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prefetch.mockResolvedValue(undefined)
  })

  it('delegates current interpolation-window prefetching to the data session', async () => {
    const config = createConfigFixture()
    const target = createTarget()

    renderHook(() => useDataPrefetch({
      config,
      target,
      enabled: true,
      dataSession: createDataSession(),
      dataOptions: DEFAULT_DATA_OPTIONS,
    }))

    await waitFor(() => {
      expect(mocks.prefetch).toHaveBeenCalledTimes(1)
    })

    expect(mocks.prefetch).toHaveBeenCalledWith(expect.objectContaining({
      target,
      config,
      options: DEFAULT_DATA_OPTIONS,
      aheadHourCount: 2,
      concurrency: 2,
      signal: expect.any(AbortSignal),
    }))
  })

  it('forwards data options to the data session prefetch', async () => {
    const config = createConfigFixture()
    const target = createTarget()

    renderHook(() => useDataPrefetch({
      config,
      target,
      enabled: true,
      dataSession: createDataSession(),
      dataOptions: { pressure: false, windVectors: true },
    }))

    await waitFor(() => {
      expect(mocks.prefetch).toHaveBeenCalledTimes(1)
    })

    expect(mocks.prefetch).toHaveBeenCalledWith(expect.objectContaining({
      options: { pressure: false, windVectors: true },
    }))
  })

  it('aborts queued prefetch work when disabled', async () => {
    const observedSignals: AbortSignal[] = []
    const observeSignal = (args: { signal: AbortSignal }) => {
      observedSignals.push(args.signal)
      return new Promise<void>(() => {})
    }
    mocks.prefetch.mockImplementation(observeSignal)
    const dataSession = createDataSession()

    const { rerender } = renderHook((props: { enabled: boolean }) => useDataPrefetch({
      config: createConfigFixture(),
      target: createTarget(),
      enabled: props.enabled,
      dataSession,
      dataOptions: DEFAULT_DATA_OPTIONS,
    }), {
      initialProps: { enabled: true },
    })

    await waitFor(() => {
      expect(mocks.prefetch).toHaveBeenCalledTimes(1)
    })

    rerender({ enabled: false })

    expect(observedSignals.every((signal) => signal.aborted)).toBe(true)
    expect(mocks.prefetch).toHaveBeenCalledTimes(1)
  })

  it('suppresses prefetch failures', async () => {
    mocks.prefetch.mockRejectedValue(new Error('prefetch failed'))

    renderHook(() => useDataPrefetch({
      config: createConfigFixture(),
      target: createTarget(),
      enabled: true,
      dataSession: createDataSession(),
      dataOptions: DEFAULT_DATA_OPTIONS,
    }))

    await waitFor(() => {
      expect(mocks.prefetch).toHaveBeenCalledTimes(1)
    })
  })
})
