import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ForecastSyncPlan } from '../plan'
import {
  createBaseRunnerArgs,
  createRunnerWindows,
  createSyncCallbacks,
  deferred,
  renderRequestRunnerHarness,
  resetRequestRunnerMocks,
  runnerMocks,
  planAt,
} from './requestRunner.testHarness'

describe('useRequestRunner callback stability', () => {
  beforeEach(resetRequestRunnerMocks)

  it('does not rerun requests when the probe frame callback changes', async () => {
    const firstCallback = vi.fn()
    const secondCallback = vi.fn()
    const args = createBaseRunnerArgs({
      onProbeFrameChange: firstCallback,
    })
    const callbacks = args.syncCallbacks
    const { rerender } = renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledTimes(1)
      expect(firstCallback).toHaveBeenCalledWith(runnerMocks.rasterWindow)
    })
    expect(runnerMocks.loadJob).toHaveBeenCalledTimes(1)

    rerender({
      ...args,
      onProbeFrameChange: secondCallback,
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(runnerMocks.loadJob).toHaveBeenCalledTimes(1)
    expect(secondCallback).not.toHaveBeenCalled()

    const plan = args.plan as ForecastSyncPlan
    rerender({
      ...args,
      onProbeFrameChange: secondCallback,
      plan: planAt(plan, 1),
    })

    await waitFor(() => {
      expect(runnerMocks.loadJob).toHaveBeenCalledTimes(2)
      expect(secondCallback).toHaveBeenCalledWith(runnerMocks.rasterWindow)
    })
  })

  it('does not rerun requests when sync callbacks change and uses the latest callbacks', async () => {
    const windows = createRunnerWindows()
    const request = deferred<typeof windows>()
    runnerMocks.loadJob.mockImplementation(() => request.promise)

    const firstCallbacks = createSyncCallbacks()
    const secondCallbacks = createSyncCallbacks()
    const args = createBaseRunnerArgs({
      syncCallbacks: firstCallbacks,
    })
    const { rerender } = renderRequestRunnerHarness(args)

    expect(firstCallbacks.onRequestStart).toHaveBeenCalledWith(
      (args.plan as ForecastSyncPlan).selectedValidTimeMs
    )

    rerender({
      ...args,
      syncCallbacks: secondCallbacks,
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(runnerMocks.loadJob).toHaveBeenCalledTimes(1)
    expect(secondCallbacks.onRequestStart).not.toHaveBeenCalled()

    request.resolve(windows)
    await waitFor(() => {
      expect(secondCallbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.plan as ForecastSyncPlan).selectedValidTimeMs
      )
    })
    expect(firstCallbacks.onRequestApplied).not.toHaveBeenCalled()
  })
})
