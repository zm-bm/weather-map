import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import type { ForecastSyncPlan } from '../plan'
import { createRasterWindowFixture } from '@/test/fixtures'
import {
  createBaseRunnerArgs,
  createRunnerWindows,
  deferred,
  renderRequestRunnerHarness,
  resetRequestRunnerMocks,
  runnerMocks,
  planAt,
} from './requestRunner.testHarness'

describe('useRequestRunner initial sync and errors', () => {
  beforeEach(resetRequestRunnerMocks)

  it('does not rerun requests while initial sync is blocked after an initial failure', async () => {
    const initialSyncError = new Error('wind failed')
    runnerMocks.loadJob.mockRejectedValueOnce(initialSyncError)

    const args = createBaseRunnerArgs()
    const callbacks = args.syncCallbacks
    const { rerender, result } = renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(callbacks.onRequestError).toHaveBeenCalledWith(
        (args.plan as ForecastSyncPlan).selectedValidTimeMs,
        initialSyncError
      )
      expect(result.current.phase).toBe('error')
      expect(result.current.errorMessage).toBe('wind failed')
    })

    rerender({
      ...args,
      plan: planAt(args.plan as ForecastSyncPlan, 1),
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(runnerMocks.loadJob).toHaveBeenCalledTimes(1)
    expect(runnerMocks.applyRenderWindows).not.toHaveBeenCalled()
  })

  it('fires start then applied callbacks when engine succeeds', async () => {
    const windows = createRunnerWindows()
    const request = deferred<typeof windows>()
    runnerMocks.loadJob.mockImplementation(() => request.promise)

    const args = createBaseRunnerArgs()
    const callbacks = args.syncCallbacks
    const { result } = renderRequestRunnerHarness(args)

    expect(result.current.phase).toBe('loading')
    expect(result.current.errorMessage).toBeNull()
    expect(callbacks.onRequestStart).toHaveBeenCalledWith(
      (args.plan as ForecastSyncPlan).selectedValidTimeMs
    )
    expect(callbacks.onRequestApplied).not.toHaveBeenCalled()

    request.resolve(windows)
    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.plan as ForecastSyncPlan).selectedValidTimeMs
      )
      expect(result.current.phase).toBe('ready')
      expect(result.current.errorMessage).toBeNull()
    })
  })

  it('ignores abort errors without notifying request error callbacks', async () => {
    const abortError = new Error('Operation aborted')
    abortError.name = 'AbortError'
    runnerMocks.loadJob.mockRejectedValue(abortError)

    const args = createBaseRunnerArgs()
    const callbacks = args.syncCallbacks
    const { result } = renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(runnerMocks.loadJob).toHaveBeenCalledTimes(1)
      expect(runnerMocks.applyRenderWindows).not.toHaveBeenCalled()
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(callbacks.onRequestError).not.toHaveBeenCalled()
    expect(result.current.phase).toBe('loading')
    expect(result.current.errorMessage).toBeNull()
  })

  it('transitions to error, then retry reruns and reaches ready', async () => {
    const initialSyncError = new Error('wind failed')
    runnerMocks.loadJob
      .mockRejectedValueOnce(initialSyncError)
      .mockResolvedValueOnce(createRunnerWindows())

    const args = createBaseRunnerArgs()
    const callbacks = args.syncCallbacks
    const { result } = renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(callbacks.onRequestError).toHaveBeenCalledWith(
        (args.plan as ForecastSyncPlan).selectedValidTimeMs,
        initialSyncError
      )
      expect(result.current.phase).toBe('error')
      expect(result.current.errorMessage).toBe('wind failed')
    })
    expect(runnerMocks.loadJob).toHaveBeenCalledTimes(1)
    expect(runnerMocks.applyRenderWindows).not.toHaveBeenCalled()

    act(() => {
      result.current.retry()
    })

    await waitFor(() => {
      expect(runnerMocks.loadJob).toHaveBeenCalledTimes(2)
      expect(runnerMocks.applyRenderWindows).toHaveBeenCalledTimes(1)
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.plan as ForecastSyncPlan).selectedValidTimeMs
      )
      expect(result.current.phase).toBe('ready')
      expect(result.current.errorMessage).toBeNull()
    })
  })

  it('forwards later sync errors without re-entering initial sync error', async () => {
    const laterError = new Error('later timeline error')
    const probeFrame = createRasterWindowFixture({ layerId: 'temperature', frame: 1 })
    runnerMocks.loadJob
      .mockResolvedValueOnce(createRunnerWindows({ raster: probeFrame }))
      .mockRejectedValueOnce(laterError)

    const args = createBaseRunnerArgs()
    const callbacks = args.syncCallbacks
    const { rerender, result } = renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.plan as ForecastSyncPlan).selectedValidTimeMs
      )
      expect(result.current.phase).toBe('ready')
      expect(args.onProbeFrameChange).toHaveBeenCalledWith(probeFrame)
    })

    const nextPlan = planAt(args.plan as ForecastSyncPlan, 1)
    rerender({ ...args, plan: nextPlan })

    await waitFor(() => {
      expect(callbacks.onRequestError).toHaveBeenCalledWith(
        nextPlan.selectedValidTimeMs,
        laterError,
      )
    })
    expect(result.current.phase).toBe('ready')
    expect(result.current.errorMessage).toBeNull()
    expect(args.onProbeFrameChange).toHaveBeenCalledTimes(1)
  })
})
