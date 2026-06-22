import { waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import type { ForecastSyncPlan } from '../plan'
import {
  createRasterLayerSourceFixture,
  createForecastSyncPlanFixture,
  createRasterWindowFixture,
} from '@/test/fixtures'
import {
  createBaseRunnerArgs,
  createRunnerWindows,
  renderRequestRunnerHarness,
  resetRequestRunnerMocks,
  runnerMocks,
  planAt,
} from './requestRunner.testHarness'

describe('useRequestRunner loading jobs', () => {
  beforeEach(resetRequestRunnerMocks)

  it('forwards resolved window plans to the sync session', async () => {
    const plan = createForecastSyncPlanFixture({
      layerSource: createRelativeHumiditySource(),
    })
    const args = createBaseRunnerArgs({ plan })

    renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(runnerMocks.loadJob).toHaveBeenCalledTimes(1)
      expect(runnerMocks.applyRenderWindows).toHaveBeenCalledTimes(1)
    })

    expect(runnerMocks.createLoadJob).toHaveBeenCalledWith(expect.objectContaining({
      plan,
    }))
    expect(plan.windowPlans.find((spec) => spec.id === 'particles')).toMatchObject({
      frames: [{
        artifactId: 'wind10m_uv',
        bandIds: ['u', 'v'],
      }],
    })
  })

  it('forwards plans without particle windows when no wind-vector artifact is available', async () => {
    const plan = createForecastSyncPlanFixture({
      layerSource: createRelativeHumiditySource(),
      particleSource: null,
    })
    const args = createBaseRunnerArgs({
      plan,
    })

    renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(runnerMocks.loadJob).toHaveBeenCalledTimes(1)
      expect(runnerMocks.applyRenderWindows).toHaveBeenCalledTimes(1)
    })

    expect(runnerMocks.createLoadJob).toHaveBeenCalledWith(expect.objectContaining({
      plan,
    }))
    expect(plan.windowPlans.some((spec) => spec.id === 'particles')).toBe(false)
  })

  it('commits loaded windows only after render application succeeds', async () => {
    const firstWindows = createRunnerWindows({
      raster: createRasterWindowFixture({ layerId: 'temperature', frame: 1 }),
      particles: { lower: { artifactId: 'wind10m_uv', frame: 1 } },
    })
    const secondWindows = createRunnerWindows({
      raster: createRasterWindowFixture({ layerId: 'temperature', frame: 2 }),
      particles: { lower: { artifactId: 'wind10m_uv', frame: 2 } },
    })
    runnerMocks.loadJob
      .mockResolvedValueOnce(firstWindows)
      .mockResolvedValueOnce(secondWindows)

    const args = createBaseRunnerArgs()
    const plan = args.plan as ForecastSyncPlan
    const { rerender } = renderRequestRunnerHarness(args)

    await waitFor(() => {
      expect(runnerMocks.loadJob).toHaveBeenCalledTimes(1)
    })
    expect(runnerMocks.commitJob).toHaveBeenCalledWith(firstWindows)

    rerender({
      ...args,
      plan: planAt(plan, 1),
    })

    await waitFor(() => {
      expect(runnerMocks.loadJob).toHaveBeenCalledTimes(2)
    })
    expect(runnerMocks.commitJob).toHaveBeenCalledWith(secondWindows)
  })
})

function createRelativeHumiditySource() {
  return createRasterLayerSourceFixture({
    layerId: 'relative_humidity',
    displayProfile: 'relative-humidity',
    artifactId: 'rh_surface',
  })
}
