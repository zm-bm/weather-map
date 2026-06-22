import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ForecastSyncPlan } from '../plan'
import type { ForecastRenderHost } from '@/forecast/render'
import {
  createForecastSyncPlanFixture,
} from '@/test/fixtures'
import {
  createBaseRunnerArgs,
  createLoadJobSignal,
  createRunnerWindows,
  deferred,
  renderRequestRunnerHarness,
  resetRequestRunnerMocks,
  runnerMocks,
  planAt,
} from './requestRunner.testHarness'

describe('useRequestRunner lifecycle', () => {
  beforeEach(resetRequestRunnerMocks)

  it('does not sync when plan or render host is missing', async () => {
    const args = createBaseRunnerArgs({ plan: null })

    const { result } = renderRequestRunnerHarness(args)

    await act(async () => {
      await Promise.resolve()
    })

    expect(runnerMocks.loadJob).not.toHaveBeenCalled()
    expect(runnerMocks.applyRenderWindows).not.toHaveBeenCalled()
    expect(args.onProbeFrameChange).toHaveBeenCalledWith(null)
    expect(args.onFieldLoadingChange).toHaveBeenLastCalledWith(false)
    expect(result.current.phase).toBe('idle')
    expect(result.current.errorMessage).toBeNull()
  })

  it('waits for a render host before syncing', async () => {
    const args = createBaseRunnerArgs({ renderHost: null })
    const callbacks = args.syncCallbacks
    const { rerender, result } = renderRequestRunnerHarness(args)

    await act(async () => {
      await Promise.resolve()
    })

    expect(runnerMocks.loadJob).not.toHaveBeenCalled()
    expect(runnerMocks.applyRenderWindows).not.toHaveBeenCalled()
    expect(callbacks.onRequestStart).not.toHaveBeenCalled()
    expect(args.onFieldLoadingChange).toHaveBeenLastCalledWith(false)
    expect(result.current.phase).toBe('loading')

    rerender({
      ...args,
      renderHost: { version: 1, apply: runnerMocks.applyRenderWindows },
    })

    await waitFor(() => {
      expect(runnerMocks.loadJob).toHaveBeenCalledTimes(1)
      expect(runnerMocks.applyRenderWindows).toHaveBeenCalledTimes(1)
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.plan as ForecastSyncPlan).selectedValidTimeMs
      )
      expect(result.current.phase).toBe('ready')
    })
  })

  it('reports field loading around real requests', async () => {
    const windows = createRunnerWindows()
    const request = deferred<typeof windows>()
    const onFieldLoadingChange = vi.fn()
    runnerMocks.loadJob.mockImplementationOnce(() => request.promise)

    const args = createBaseRunnerArgs({ onFieldLoadingChange })
    const callbacks = args.syncCallbacks
    renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(callbacks.onRequestStart).toHaveBeenCalledWith(
        (args.plan as ForecastSyncPlan).selectedValidTimeMs
      )
      expect(onFieldLoadingChange).toHaveBeenLastCalledWith(true)
    })

    act(() => {
      request.resolve(windows)
    })

    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.plan as ForecastSyncPlan).selectedValidTimeMs
      )
      expect(onFieldLoadingChange).toHaveBeenLastCalledWith(false)
    })
  })

  it('starts syncing when request becomes enabled', async () => {
    const plan = createForecastSyncPlanFixture()
    const args = createBaseRunnerArgs({
      plan: null,
    })
    const callbacks = args.syncCallbacks
    const { rerender, result } = renderRequestRunnerHarness(args)

    expect(runnerMocks.loadJob).not.toHaveBeenCalled()
    expect(result.current.phase).toBe('idle')

    rerender({ ...args, plan })

    await waitFor(() => {
      expect(runnerMocks.loadJob).toHaveBeenCalledTimes(1)
      expect(runnerMocks.applyRenderWindows).toHaveBeenCalledTimes(1)
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(plan.selectedValidTimeMs)
      expect(result.current.phase).toBe('ready')
    })
  })

  it('dedupes identical request keys for the same render host', async () => {
    const args = createBaseRunnerArgs()
    const callbacks = args.syncCallbacks
    const { rerender, result } = renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledTimes(1)
    })
    expect(result.current.errorMessage).toBeNull()
    expect(result.current.phase).toBe('ready')
    expect(runnerMocks.loadJob).toHaveBeenCalledTimes(1)
    expect(runnerMocks.applyRenderWindows).toHaveBeenCalledTimes(1)
    expect(args.onFieldLoadingChange).toHaveBeenLastCalledWith(false)

    rerender({
      ...args,
      config: { ...args.config },
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(runnerMocks.loadJob).toHaveBeenCalledTimes(1)
    expect(runnerMocks.applyRenderWindows).toHaveBeenCalledTimes(1)
    expect(args.onFieldLoadingChange).toHaveBeenLastCalledWith(false)
  })

  it('reapplies the current plan when render host version changes', async () => {
    const args = createBaseRunnerArgs()
    const callbacks = args.syncCallbacks
    const { rerender } = renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledTimes(1)
    })

    rerender({
      ...args,
      renderHost: {
        ...(args.renderHost as ForecastRenderHost),
        version: 2,
      },
    })

    await waitFor(() => {
      expect(runnerMocks.loadJob).toHaveBeenCalledTimes(2)
      expect(runnerMocks.applyRenderWindows).toHaveBeenCalledTimes(2)
      expect(callbacks.onRequestApplied).toHaveBeenCalledTimes(2)
    })
  })

  it('resets initial sync state and aborts in-flight request when request becomes disabled', async () => {
    const request = deferred<void>()
    runnerMocks.loadJob.mockImplementationOnce(() => request.promise)

    const args = createBaseRunnerArgs()
    const { rerender, result } = renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(runnerMocks.loadJob).toHaveBeenCalledTimes(1)
      expect(runnerMocks.applyRenderWindows).not.toHaveBeenCalled()
      expect(result.current.phase).toBe('loading')
    })

    rerender({ ...args, plan: null })

    await waitFor(() => {
      expect(createLoadJobSignal(0).aborted).toBe(true)
      expect(result.current.phase).toBe('idle')
      expect(result.current.errorMessage).toBeNull()
    })
    expect(args.onProbeFrameChange).toHaveBeenCalledWith(null)
    expect(args.onFieldLoadingChange).toHaveBeenLastCalledWith(false)
    expect(runnerMocks.resetSession).toHaveBeenCalled()
  })

  it('aborts in-flight requests on unmount and ignores settled data', async () => {
    const windows = createRunnerWindows()
    const request = deferred<typeof windows>()
    runnerMocks.loadJob.mockImplementationOnce(() => request.promise)

    const args = createBaseRunnerArgs()
    const callbacks = args.syncCallbacks
    const { unmount } = renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(runnerMocks.loadJob).toHaveBeenCalledTimes(1)
      expect(createLoadJobSignal(0)).toBeDefined()
    })

    unmount()
    expect(createLoadJobSignal(0).aborted).toBe(true)
    expect(args.onFieldLoadingChange).toHaveBeenLastCalledWith(false)
    expect(runnerMocks.resetSession).toHaveBeenCalled()

    await act(async () => {
      request.resolve(windows)
      await request.promise
      await Promise.resolve()
    })

    expect(runnerMocks.applyRenderWindows).not.toHaveBeenCalled()
    expect(callbacks.onRequestApplied).not.toHaveBeenCalled()
    expect(args.onProbeFrameChange).not.toHaveBeenCalled()
  })

  it('aborts an in-flight request when the plan returns to an already applied frame', async () => {
    const args = createBaseRunnerArgs()
    const callbacks = args.syncCallbacks
    const { rerender } = renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.plan as ForecastSyncPlan).selectedValidTimeMs
      )
    })

    const request = deferred<void>()
    runnerMocks.loadJob.mockImplementationOnce(() => request.promise)
    const nextPlan = planAt(args.plan as ForecastSyncPlan, 1)

    rerender({ ...args, plan: nextPlan })

    await waitFor(() => {
      expect(runnerMocks.loadJob).toHaveBeenCalledTimes(2)
      expect(createLoadJobSignal(1)).toBeDefined()
    })

    rerender(args)

    await waitFor(() => {
      expect(createLoadJobSignal(1).aborted).toBe(true)
    })

    request.resolve()
    await act(async () => {
      await Promise.resolve()
    })

    expect(callbacks.onRequestApplied).toHaveBeenCalledTimes(1)
    expect(args.onProbeFrameChange).toHaveBeenCalledTimes(1)
  })
})
