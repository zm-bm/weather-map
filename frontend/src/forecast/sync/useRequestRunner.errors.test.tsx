import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import type { ForecastDataTarget } from '@/forecast/data'
import {
  createBaseRunnerArgs,
  createRunnerLoadedData,
  deferred,
  renderRequestRunnerHarness,
  resetRequestRunnerMocks,
  runnerMocks,
  targetAt,
} from './requestRunner.testHarness'

describe('useRequestRunner startup and errors', () => {
  beforeEach(resetRequestRunnerMocks)

  it('does not rerun requests while startup is blocked after an initial failure', async () => {
    const startupError = new Error('wind failed')
    runnerMocks.loadJob.mockRejectedValueOnce(startupError)

    const args = createBaseRunnerArgs()
    const callbacks = args.syncCallbacks
    const { rerender, result } = renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(callbacks.onRequestError).toHaveBeenCalledWith(
        (args.target as ForecastDataTarget).selectedValidTimeMs,
        startupError
      )
      expect(result.current.startupPhase).toBe('error')
      expect(result.current.startupErrorMessage).toBe('wind failed')
    })

    rerender({
      ...args,
      target: targetAt(args.target as ForecastDataTarget, 1),
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(runnerMocks.loadJob).toHaveBeenCalledTimes(1)
    expect(runnerMocks.applyRenderData).not.toHaveBeenCalled()
  })

  it('fires start then applied callbacks when engine succeeds', async () => {
    const frames = createRunnerLoadedData()
    const request = deferred<typeof frames>()
    runnerMocks.loadJob.mockImplementation(() => request.promise)

    const args = createBaseRunnerArgs()
    const callbacks = args.syncCallbacks
    const { result } = renderRequestRunnerHarness(args)

    expect(result.current.startupPhase).toBe('loading')
    expect(result.current.startupErrorMessage).toBeNull()
    expect(callbacks.onRequestStart).toHaveBeenCalledWith(
      (args.target as ForecastDataTarget).selectedValidTimeMs
    )
    expect(callbacks.onRequestApplied).not.toHaveBeenCalled()

    request.resolve(frames)
    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.target as ForecastDataTarget).selectedValidTimeMs
      )
      expect(result.current.startupPhase).toBe('ready')
      expect(result.current.startupErrorMessage).toBeNull()
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
      expect(runnerMocks.applyRenderData).not.toHaveBeenCalled()
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(callbacks.onRequestError).not.toHaveBeenCalled()
    expect(result.current.startupPhase).toBe('loading')
    expect(result.current.startupErrorMessage).toBeNull()
  })

  it('transitions to error, then retry reruns and reaches ready', async () => {
    const startupError = new Error('wind failed')
    runnerMocks.loadJob
      .mockRejectedValueOnce(startupError)
      .mockResolvedValueOnce(createRunnerLoadedData())

    const args = createBaseRunnerArgs()
    const callbacks = args.syncCallbacks
    const { result } = renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(callbacks.onRequestError).toHaveBeenCalledWith(
        (args.target as ForecastDataTarget).selectedValidTimeMs,
        startupError
      )
      expect(result.current.startupPhase).toBe('error')
      expect(result.current.startupErrorMessage).toBe('wind failed')
    })
    expect(runnerMocks.loadJob).toHaveBeenCalledTimes(1)
    expect(runnerMocks.applyRenderData).not.toHaveBeenCalled()

    act(() => {
      result.current.retry()
    })

    await waitFor(() => {
      expect(runnerMocks.loadJob).toHaveBeenCalledTimes(2)
      expect(runnerMocks.applyRenderData).toHaveBeenCalledTimes(1)
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.target as ForecastDataTarget).selectedValidTimeMs
      )
      expect(result.current.startupPhase).toBe('ready')
      expect(result.current.startupErrorMessage).toBeNull()
    })
  })

  it('forwards later sync errors without re-entering startup error', async () => {
    const laterError = new Error('later timeline error')
    const probeFrame = createFieldFrameLike('temperature', 1)
    runnerMocks.loadJob
      .mockResolvedValueOnce(createRunnerLoadedData({ probeField: probeFrame }))
      .mockRejectedValueOnce(laterError)

    const args = createBaseRunnerArgs()
    const callbacks = args.syncCallbacks
    const { rerender, result } = renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(callbacks.onRequestApplied).toHaveBeenCalledWith(
        (args.target as ForecastDataTarget).selectedValidTimeMs
      )
      expect(result.current.startupPhase).toBe('ready')
      expect(args.onProbeFrameChange).toHaveBeenCalledWith(probeFrame)
    })

    const nextTarget = targetAt(args.target as ForecastDataTarget, 1)
    rerender({ ...args, target: nextTarget })

    await waitFor(() => {
      expect(callbacks.onRequestError).toHaveBeenCalledWith(
        nextTarget.selectedValidTimeMs,
        laterError,
      )
    })
    expect(result.current.startupPhase).toBe('ready')
    expect(result.current.startupErrorMessage).toBeNull()
    expect(args.onProbeFrameChange).toHaveBeenCalledTimes(1)
  })
})

function createFieldFrameLike(layerId: string, frame: number) {
  return {
    lower: { layerId, frame },
    upper: { layerId, frame },
    mix: 0,
  }
}
