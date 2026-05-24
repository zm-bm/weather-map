import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createConfigFixture,
  createDataSessionFixture,
  createDeferred,
  createForecastDataTargetFixture,
} from '@/test/fixtures'
import type { ForecastDataTarget } from '@/forecast/data'
import { useDataPrefetch } from './useDataPrefetch'

const mocks = vi.hoisted(() => ({
  prefetch: vi.fn(),
}))

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

type DataPrefetchArgs = Parameters<typeof useDataPrefetch>[0]

function createPrefetchArgs(overrides: Partial<DataPrefetchArgs> = {}): DataPrefetchArgs {
  return {
    config: createConfigFixture(),
    target: createTarget(),
    enabled: true,
    dataSession: createDataSessionFixture({ prefetch: mocks.prefetch }),
    dataOptions: { pressure: true, windVectors: true },
    ...overrides,
  }
}

function renderPrefetch(overrides: Partial<DataPrefetchArgs> = {}) {
  const args = createPrefetchArgs(overrides)
  return renderHook((nextArgs: Partial<DataPrefetchArgs> = {}) => (
    useDataPrefetch({ ...args, ...nextArgs })
  ))
}

describe('useDataPrefetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prefetch.mockResolvedValue(undefined)
  })

  it('delegates current interpolation-window prefetching to the data session', async () => {
    const config = createConfigFixture()
    const target = createTarget()
    const dataOptions = { pressure: false, windVectors: true }

    renderPrefetch({
      config,
      target,
      dataOptions,
    })

    await waitFor(() => {
      expect(mocks.prefetch).toHaveBeenCalledTimes(1)
    })

    expect(mocks.prefetch).toHaveBeenCalledWith(expect.objectContaining({
      target,
      config,
      options: dataOptions,
      aheadHourCount: 2,
      concurrency: 2,
      signal: expect.any(AbortSignal),
    }))
  })

  it('aborts queued prefetch work when disabled', async () => {
    const observedSignals: AbortSignal[] = []
    const pendingPrefetch = createDeferred<void>()
    const observeSignal = (args: { signal: AbortSignal }) => {
      observedSignals.push(args.signal)
      return pendingPrefetch.promise
    }
    mocks.prefetch.mockImplementation(observeSignal)
    const dataSession = createDataSessionFixture({ prefetch: mocks.prefetch })

    const { rerender } = renderPrefetch({
      dataSession,
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

    renderPrefetch()

    await waitFor(() => {
      expect(mocks.prefetch).toHaveBeenCalledTimes(1)
    })
  })
})
