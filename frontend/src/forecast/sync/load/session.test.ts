import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createActiveRunFixture,
  createConfigFixture,
  createRasterLayerSourceFixture,
  createForecastSyncPlanFixture,
  createScalarPayloadFixture,
  createSignalFixture,
  createSingleTimeManifestFixture,
} from '@/test/fixtures'
import type { ForecastLayerSource } from '@/forecast/catalog/source'
import { stubFetchArrayBufferOnce } from '@/test/fetch'
import { __resetPayloadCacheForTests } from '@/forecast/artifacts/payloadCache'
import { createForecastSyncSession } from './session'

beforeEach(async () => {
  await __resetPayloadCacheForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function createTarget(args: {
  layerSource?: ForecastLayerSource
  forecastHours?: string[]
  scalarArtifactIds?: string[]
  vectorArtifactIds?: string[]
} = {}) {
  const activeRun = createActiveRunFixture(createSingleTimeManifestFixture({
    forecastHours: args.forecastHours ?? ['000', '003'],
    scalarArtifactIds: args.scalarArtifactIds,
    vectorArtifactIds: args.vectorArtifactIds,
  }))

  return createForecastSyncPlanFixture({
    activeRun,
    layerSource: args.layerSource,
    interpolationWindow: {
      selectedValidTimeMs: Date.UTC(2026, 3, 13, 12),
      lowerHourToken: '000',
      upperHourToken: '000',
      lowerValidTimeMs: Date.UTC(2026, 3, 13, 12),
      upperValidTimeMs: Date.UTC(2026, 3, 13, 12),
      mix: 0,
    },
  })
}

function relativeHumiditySource(): ForecastLayerSource {
  return createRasterLayerSourceFixture({
    layerId: 'relative_humidity',
    displayProfile: 'relative-humidity',
    artifactId: 'rh_surface',
  })
}

function createLoadJob(args: {
  plan?: ReturnType<typeof createTarget>
  session?: ReturnType<typeof createForecastSyncSession>
} = {}) {
  const session = args.session ?? createForecastSyncSession()
  return session.createLoadJob({
    plan: args.plan ?? createTarget(),
    config: createConfigFixture(),
    signal: createSignalFixture(),
    retryToken: 0,
  })
}

describe('createForecastSyncSession', () => {
  it('creates load jobs with request identity and selected valid time', () => {
    const job = createLoadJob({
      plan: createTarget({
        scalarArtifactIds: ['tmp_surface'],
        vectorArtifactIds: [],
      }),
    })

    expect(job.key).toContain('tmp_surface')
    expect(job.key).toContain(':000:000:0:0')
    expect(job.selectedValidTimeMs).toBe(Date.UTC(2026, 3, 13, 12))
    expect(job.shouldClearProbeFrame).toBe(false)
  })

  it('reuses committed windows and clears probe frames when the probe source changes', async () => {
    const session = createForecastSyncSession()
    const firstPayload = createScalarPayloadFixture([1, 2, 3, 4])
    const fetchMock = stubFetchArrayBufferOnce(firstPayload)
    const firstJob = createLoadJob({
      session,
      plan: createTarget({
        scalarArtifactIds: ['tmp_surface'],
        vectorArtifactIds: [],
      }),
    })
    const firstData = await firstJob.load()
    firstJob.commit(firstData)

    const sameJob = createLoadJob({
      session,
      plan: createTarget({
        scalarArtifactIds: ['tmp_surface'],
        vectorArtifactIds: [],
      }),
    })
    const sameData = await sameJob.load()
    expect(sameData.raster?.lower).toBe(firstData.raster?.lower)
    expect(sameJob.shouldClearProbeFrame).toBe(false)

    const nextJob = createLoadJob({
      session,
      plan: createTarget({
        layerSource: relativeHumiditySource(),
        scalarArtifactIds: ['rh_surface'],
        vectorArtifactIds: [],
      }),
    })
    expect(nextJob.shouldClearProbeFrame).toBe(true)

    session.reset()
    const resetJob = createLoadJob({
      session,
      plan: createTarget({
        scalarArtifactIds: ['tmp_surface'],
        vectorArtifactIds: [],
      }),
    })
    expect(resetJob.shouldClearProbeFrame).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('prefetches through the private request path without committing reusable windows', async () => {
    const session = createForecastSyncSession()
    const payload = createScalarPayloadFixture([1, 2, 3, 4])
    const fetchMock = stubFetchArrayBufferOnce(payload)

    await session.prefetch({
      plan: createTarget({
        forecastHours: ['000'],
        scalarArtifactIds: ['tmp_surface'],
        vectorArtifactIds: [],
      }),
      config: createConfigFixture(),
      signal: createSignalFixture(),
      aheadHourCount: 0,
      concurrency: 1,
    })

    const nextJob = createLoadJob({
      session,
      plan: createTarget({
        forecastHours: ['000'],
        scalarArtifactIds: ['tmp_surface'],
        vectorArtifactIds: [],
      }),
    })
    expect(nextJob.shouldClearProbeFrame).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('suppresses opportunistic prefetch failures', async () => {
    const session = createForecastSyncSession()
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('prefetch failed')
    }))

    await expect(session.prefetch({
      plan: createTarget({
        forecastHours: ['000'],
        scalarArtifactIds: ['tmp_surface'],
        vectorArtifactIds: [],
      }),
      config: createConfigFixture(),
      signal: createSignalFixture(),
      aheadHourCount: 0,
      concurrency: 1,
    })).resolves.toBeUndefined()
  })
})
