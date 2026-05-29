import { waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import type { ForecastSyncPlan } from '../plan'
import {
  createBaseRunnerArgs,
  createDefaultLoadJob,
  createRunnerLoadJobFixture,
  createRunnerWindows,
  deferred,
  renderRequestRunnerHarness,
  resetRequestRunnerMocks,
  runnerMocks,
  planAt,
} from './requestRunner.testHarness'

describe('useRequestRunner probe frames', () => {
  beforeEach(resetRequestRunnerMocks)

  it('publishes the selected layer probe frame after render succeeds', async () => {
    const probeFrame = { lower: { layerId: 'relative_humidity' } }
    const windows = createRunnerWindows({
      raster: probeFrame,
      particles: { lower: { artifactId: 'wind10m_uv' } },
    })
    runnerMocks.loadJob.mockResolvedValueOnce(windows)
    const args = createBaseRunnerArgs()

    renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(runnerMocks.applyRenderWindows).toHaveBeenCalledWith(windows)
      expect(args.onProbeFrameChange).toHaveBeenCalledWith(probeFrame)
    })
  })

  it('does not update the probe frame when render application fails', async () => {
    const renderError = new Error('render failed')
    runnerMocks.applyRenderWindows.mockImplementationOnce(() => {
      throw renderError
    })
    const args = createBaseRunnerArgs()
    const callbacks = args.syncCallbacks
    const { result } = renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(callbacks.onRequestError).toHaveBeenCalledWith(
        (args.plan as ForecastSyncPlan).selectedValidTimeMs,
        renderError
      )
      expect(result.current.phase).toBe('error')
    })

    expect(args.onProbeFrameChange).not.toHaveBeenCalled()
  })

  it('clears the applied probe window before loading a different probe channel', async () => {
    const probeFrame = { lower: { layerId: 'temperature', frame: 1 } }
    const firstWindows = createRunnerWindows({
      raster: probeFrame,
      particles: { lower: { artifactId: 'wind10m_uv', frame: 1 } },
    })
    const secondRequest = deferred<typeof firstWindows>()
    runnerMocks.createLoadJob
      .mockImplementationOnce((args) => createDefaultLoadJob(args))
      .mockImplementationOnce((args) => createRunnerLoadJobFixture({
        key: `job:${args.plan.selectedValidTimeMs}:${args.retryToken}`,
        selectedValidTimeMs: args.plan.selectedValidTimeMs,
        shouldClearProbeFrame: true,
      }))
    runnerMocks.loadJob
      .mockResolvedValueOnce(firstWindows)
      .mockImplementationOnce(() => secondRequest.promise)

    const args = createBaseRunnerArgs()
    const plan = args.plan as ForecastSyncPlan
    const { rerender } = renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(args.onProbeFrameChange).toHaveBeenCalledWith(probeFrame)
    })

    rerender({
      ...args,
      plan: planAt(plan, 1),
    })

    await waitFor(() => {
      expect(runnerMocks.loadJob).toHaveBeenCalledTimes(2)
      expect(args.onProbeFrameChange).toHaveBeenLastCalledWith(null)
    })

    secondRequest.resolve(firstWindows)
  })

})
