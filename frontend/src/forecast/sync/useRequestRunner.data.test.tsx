import { waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import type { ForecastDataTarget } from '@/forecast/data'
import {
  createFieldLayerSourceFixture,
  createForecastDataTargetFixture,
} from '@/test/fixtures'
import {
  createBaseRunnerArgs,
  createRunnerLoadedData,
  renderRequestRunnerHarness,
  resetRequestRunnerMocks,
  runnerMocks,
  targetAt,
} from './requestRunner.testHarness'

describe('useRequestRunner data jobs', () => {
  beforeEach(resetRequestRunnerMocks)

  it('forwards selected layer and wind-vector source to data loading', async () => {
    const target = createForecastDataTargetFixture({
      layerSource: createRelativeHumiditySource(),
    })
    const args = createBaseRunnerArgs({ target })

    renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(runnerMocks.loadJob).toHaveBeenCalledTimes(1)
      expect(runnerMocks.applyRenderData).toHaveBeenCalledTimes(1)
    })

    expect(runnerMocks.createLoadJob).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({
        windVectorSource: expect.objectContaining({
          artifactId: 'wind10m_uv',
        }),
      }),
    }))
  })

  it('forwards null wind-vector source to data loading when no wind-vector artifact is available', async () => {
    const args = createBaseRunnerArgs({
      target: createForecastDataTargetFixture({
        layerSource: createRelativeHumiditySource(),
        windVectorSource: null,
      }),
    })

    renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(runnerMocks.loadJob).toHaveBeenCalledTimes(1)
      expect(runnerMocks.applyRenderData).toHaveBeenCalledTimes(1)
    })

    expect(runnerMocks.createLoadJob).toHaveBeenCalledWith(expect.objectContaining({
      target: expect.objectContaining({
        windVectorSource: null,
      }),
    }))
  })

  it('forwards disabled pressure options to data loading', async () => {
    const args = createBaseRunnerArgs({
      dataOptions: { pressure: false, windVectors: true },
      target: createForecastDataTargetFixture({
        windVectorSource: null,
      }),
    })

    renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(runnerMocks.loadJob).toHaveBeenCalledTimes(1)
      expect(runnerMocks.applyRenderData).toHaveBeenCalledTimes(1)
    })

    expect(runnerMocks.createLoadJob).toHaveBeenCalledWith(expect.objectContaining({
      options: { pressure: false, windVectors: true },
    }))
  })

  it('commits loaded data only after render application succeeds', async () => {
    const firstFrames = createRunnerLoadedData({
      field: createFieldFrameLike('temperature', 1),
      probeField: createFieldFrameLike('temperature', 1),
      windVectors: { lower: { artifactId: 'wind10m_uv', frame: 1 } },
    })
    const secondFrames = createRunnerLoadedData({
      field: createFieldFrameLike('temperature', 2),
      probeField: createFieldFrameLike('temperature', 2),
      windVectors: { lower: { artifactId: 'wind10m_uv', frame: 2 } },
    })
    runnerMocks.loadJob
      .mockResolvedValueOnce(firstFrames)
      .mockResolvedValueOnce(secondFrames)

    const args = createBaseRunnerArgs()
    const target = args.target as ForecastDataTarget
    const { rerender } = renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(runnerMocks.loadJob).toHaveBeenCalledTimes(1)
    })
    expect(runnerMocks.commitJob).toHaveBeenCalledWith(firstFrames)

    rerender({
      ...args,
      target: targetAt(target, 1),
    })

    await waitFor(() => {
      expect(runnerMocks.loadJob).toHaveBeenCalledTimes(2)
    })
    expect(runnerMocks.commitJob).toHaveBeenCalledWith(secondFrames)
  })
})

function createRelativeHumiditySource() {
  return createFieldLayerSourceFixture({
    layerId: 'relative_humidity',
    paletteId: 'humidity.relative.percent.v1',
    displayRange: [0, 100],
    fieldSource: {
      kind: 'scalar',
      artifactId: 'rh_surface',
    },
  })
}

function createFieldFrameLike(layerId: string, frame: number) {
  return {
    lower: { layerId, frame },
    upper: { layerId, frame },
    mix: 0,
  }
}
