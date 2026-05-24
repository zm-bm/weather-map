import { waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import type { ForecastDataTarget } from '@/forecast/data'
import { createFieldLayerSourceFixture } from '@/test/fixtures'
import {
  createBaseRunnerArgs,
  createDefaultLoadJob,
  createRunnerLoadJobFixture,
  createRunnerLoadedData,
  deferred,
  renderRequestRunnerHarness,
  resetRequestRunnerMocks,
  runnerMocks,
  targetAt,
} from './requestRunner.testHarness'

describe('useRequestRunner probe frames', () => {
  beforeEach(resetRequestRunnerMocks)

  it('publishes the selected layer probe frame after render succeeds', async () => {
    const probeFrame = { lower: { layerId: 'relative_humidity' } }
    const frames = createRunnerLoadedData({
      field: probeFrame,
      probeField: probeFrame,
      windVectors: { lower: { artifactId: 'wind10m_uv' } },
    })
    runnerMocks.loadJob.mockResolvedValueOnce(frames)
    const args = createBaseRunnerArgs()

    renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(runnerMocks.applyRenderData).toHaveBeenCalledWith(frames)
      expect(args.onProbeFrameChange).toHaveBeenCalledWith(frames.probeField)
    })
  })

  it('does not update the probe frame when render application fails', async () => {
    const renderError = new Error('render failed')
    runnerMocks.applyRenderData.mockImplementationOnce(() => {
      throw renderError
    })
    const args = createBaseRunnerArgs()
    const callbacks = args.syncCallbacks
    const { result } = renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(callbacks.onRequestError).toHaveBeenCalledWith(
        (args.target as ForecastDataTarget).selectedValidTimeMs,
        renderError
      )
      expect(result.current.phase).toBe('error')
    })

    expect(args.onProbeFrameChange).not.toHaveBeenCalled()
  })

  it('clears the applied probe field before loading a different probe channel', async () => {
    const probeFrame = { lower: { layerId: 'temperature', frame: 1 } }
    const firstFrames = createRunnerLoadedData({
      field: probeFrame,
      probeField: probeFrame,
      windVectors: { lower: { artifactId: 'wind10m_uv', frame: 1 } },
    })
    const secondRequest = deferred<typeof firstFrames>()
    runnerMocks.createLoadJob
      .mockImplementationOnce((args) => createDefaultLoadJob(args))
      .mockImplementationOnce((args) => createRunnerLoadJobFixture({
        key: `job:${args.target.selectedValidTimeMs}:${args.retryToken}`,
        selectedValidTimeMs: args.target.selectedValidTimeMs,
        shouldClearProbeFrame: true,
      }))
    runnerMocks.loadJob
      .mockResolvedValueOnce(firstFrames)
      .mockImplementationOnce(() => secondRequest.promise)

    const args = createBaseRunnerArgs()
    const target = args.target as ForecastDataTarget
    const { rerender } = renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(args.onProbeFrameChange).toHaveBeenCalledWith(firstFrames.probeField)
    })

    rerender({
      ...args,
      target: targetAt(target, 1, {
        layerSource: createFieldLayerSourceFixture({
          layerId: 'relative_humidity',
          paletteId: 'humidity.relative.percent.v1',
          displayRange: [0, 100],
          fieldSource: {
            kind: 'scalar',
            artifactId: 'rh_surface',
          },
        }),
      }),
    })

    await waitFor(() => {
      expect(runnerMocks.loadJob).toHaveBeenCalledTimes(2)
      expect(args.onProbeFrameChange).toHaveBeenLastCalledWith(null)
    })

    secondRequest.resolve(firstFrames)
  })

})
