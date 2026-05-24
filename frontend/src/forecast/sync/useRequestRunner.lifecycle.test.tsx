import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import type { ForecastDataTarget } from '@/forecast/data'
import type { ForecastRenderHost } from '@/forecast/render'
import {
  createForecastDataTargetFixture,
} from '@/test/fixtures'
import {
  createBaseRunnerArgs,
  createLoadJobSignal,
  createRunnerLoadedData,
  deferred,
  renderRequestRunnerHarness,
  resetRequestRunnerMocks,
  runnerMocks,
  targetAt,
} from './requestRunner.testHarness'

describe('useRequestRunner lifecycle', () => {
  beforeEach(resetRequestRunnerMocks)

  it('does not sync when data input is missing', async () => {
    const args = createBaseRunnerArgs({ target: null })

    const { result } = renderRequestRunnerHarness(args)

    await act(async () => {
      await Promise.resolve()
    })

    expect(runnerMocks.loadJob).not.toHaveBeenCalled()
    expect(runnerMocks.applyRenderData).not.toHaveBeenCalled()
    expect(args.onProbeFrameChange).toHaveBeenCalledWith(null)
    expect(result.current.startupPhase).toBe('idle')
    expect(result.current.startupErrorMessage).toBeNull()
  })

  it('waits for a render host before syncing', async () => {
    const args = createBaseRunnerArgs({ renderHost: null })
    const callbacks = args.syncCallbacks
    const { rerender, result } = renderRequestRunnerHarness(args)

    await act(async () => {
      await Promise.resolve()
    })

    expect(runnerMocks.loadJob).not.toHaveBeenCalled()
    expect(runnerMocks.applyRenderData).not.toHaveBeenCalled()
    expect(callbacks.onRequestStart).not.toHaveBeenCalled()
    expect(result.current.startupPhase).toBe('loading')

    rerender({
      ...args,
      renderHost: { version: 1, apply: runnerMocks.applyRenderData },
    })

    await waitFor(() => {
      expect(runnerMocks.loadJob).toHaveBeenCalledTimes(1)
      expect(runnerMocks.applyRenderData).toHaveBeenCalledTimes(1)
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.target as ForecastDataTarget).selectedValidTimeMs
      )
      expect(result.current.startupPhase).toBe('ready')
    })
  })

  it('starts syncing when request becomes enabled', async () => {
    const target = createForecastDataTargetFixture()
    const args = createBaseRunnerArgs({
      target: null,
    })
    const callbacks = args.syncCallbacks
    const { rerender, result } = renderRequestRunnerHarness(args)

    expect(runnerMocks.loadJob).not.toHaveBeenCalled()
    expect(result.current.startupPhase).toBe('idle')

    rerender({ ...args, target })

    await waitFor(() => {
      expect(runnerMocks.loadJob).toHaveBeenCalledTimes(1)
      expect(runnerMocks.applyRenderData).toHaveBeenCalledTimes(1)
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(target.selectedValidTimeMs)
      expect(result.current.startupPhase).toBe('ready')
    })
  })

  it('dedupes identical request keys for the same render host', async () => {
    const args = createBaseRunnerArgs()
    const callbacks = args.syncCallbacks
    const { rerender, result } = renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledTimes(1)
    })
    expect(result.current.startupErrorMessage).toBeNull()
    expect(result.current.startupPhase).toBe('ready')
    expect(runnerMocks.loadJob).toHaveBeenCalledTimes(1)
    expect(runnerMocks.applyRenderData).toHaveBeenCalledTimes(1)

    rerender({
      ...args,
      config: { ...args.config },
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(runnerMocks.loadJob).toHaveBeenCalledTimes(1)
    expect(runnerMocks.applyRenderData).toHaveBeenCalledTimes(1)
  })

  it('reapplies the current target when render host version changes', async () => {
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
      expect(runnerMocks.applyRenderData).toHaveBeenCalledTimes(2)
      expect(callbacks.onRequestApplied).toHaveBeenCalledTimes(2)
    })
  })

  it('resets startup state and aborts in-flight request when request becomes disabled', async () => {
    const request = deferred<void>()
    runnerMocks.loadJob.mockImplementationOnce(() => request.promise)

    const args = createBaseRunnerArgs()
    const { rerender, result } = renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(runnerMocks.loadJob).toHaveBeenCalledTimes(1)
      expect(runnerMocks.applyRenderData).not.toHaveBeenCalled()
      expect(result.current.startupPhase).toBe('loading')
    })

    rerender({ ...args, target: null })

    await waitFor(() => {
      expect(createLoadJobSignal(0).aborted).toBe(true)
      expect(result.current.startupPhase).toBe('idle')
      expect(result.current.startupErrorMessage).toBeNull()
    })
    expect(args.onProbeFrameChange).toHaveBeenCalledWith(null)
    expect(runnerMocks.resetSession).toHaveBeenCalled()
  })

  it('aborts in-flight requests on unmount and ignores settled data', async () => {
    const frames = createRunnerLoadedData()
    const request = deferred<typeof frames>()
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
    expect(runnerMocks.resetSession).toHaveBeenCalled()

    await act(async () => {
      request.resolve(frames)
      await request.promise
      await Promise.resolve()
    })

    expect(runnerMocks.applyRenderData).not.toHaveBeenCalled()
    expect(callbacks.onRequestApplied).not.toHaveBeenCalled()
    expect(args.onProbeFrameChange).not.toHaveBeenCalled()
  })

  it('aborts an in-flight request when the target returns to an already applied frame', async () => {
    const args = createBaseRunnerArgs()
    const callbacks = args.syncCallbacks
    const { rerender } = renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.target as ForecastDataTarget).selectedValidTimeMs
      )
    })

    const request = deferred<void>()
    runnerMocks.loadJob.mockImplementationOnce(() => request.promise)
    const nextTarget = targetAt(args.target as ForecastDataTarget, 1)

    rerender({ ...args, target: nextTarget })

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
