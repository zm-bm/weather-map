import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createActiveRunFixture,
  createConfigFixture,
  createFieldLayerSourceFixture,
  createForecastDataTargetFixture,
  createScalarPayloadFixture,
  createSignalFixture,
  createSingleTimeManifestFixture,
} from '@/test/fixtures'
import type { ForecastDataTarget } from './target'
import { stubFetchArrayBufferOnce } from '@/test/fetch'
import { clearFieldTimeSliceCache } from './loaders/field/load'
import { __resetFramePayloadCacheForTests } from '@/forecast/artifacts/framePayloadCache'
import { createForecastDataSession } from './session'

beforeEach(async () => {
  clearFieldTimeSliceCache()
  await __resetFramePayloadCacheForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function createTarget(args: {
  layerSource?: ForecastDataTarget['layerSource']
  forecastHours?: string[]
  scalarArtifactIds?: string[]
  vectorArtifactIds?: string[]
} = {}) {
  const activeRun = createActiveRunFixture(createSingleTimeManifestFixture({
    forecastHours: args.forecastHours ?? ['000', '003'],
    scalarArtifactIds: args.scalarArtifactIds,
    vectorArtifactIds: args.vectorArtifactIds,
  }))

  return createForecastDataTargetFixture({
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

function relativeHumiditySource(): ForecastDataTarget['layerSource'] {
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

function createLoadJob(args: {
  target?: ReturnType<typeof createTarget>
  session?: ReturnType<typeof createForecastDataSession>
} = {}) {
  const session = args.session ?? createForecastDataSession()
  return session.createLoadJob({
    target: args.target ?? createTarget(),
    config: createConfigFixture(),
    signal: createSignalFixture(),
    retryToken: 0,
  })
}

describe('createForecastDataSession', () => {
  it('creates load jobs with request identity and selected valid time', () => {
    const job = createLoadJob({
      target: createTarget({
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
    const session = createForecastDataSession()
    const firstPayload = createScalarPayloadFixture([1, 2, 3, 4])
    const fetchMock = stubFetchArrayBufferOnce(firstPayload)
    const firstJob = createLoadJob({
      session,
      target: createTarget({
        scalarArtifactIds: ['tmp_surface'],
        vectorArtifactIds: [],
      }),
    })
    const firstData = await firstJob.load()
    firstJob.commit(firstData)

    const sameJob = createLoadJob({
      session,
      target: createTarget({
        scalarArtifactIds: ['tmp_surface'],
        vectorArtifactIds: [],
      }),
    })
    const sameData = await sameJob.load()
    expect(sameData.windows.field?.lower).toBe(firstData.windows.field?.lower)
    expect(sameJob.shouldClearProbeFrame).toBe(false)

    const nextJob = createLoadJob({
      session,
      target: createTarget({
        layerSource: relativeHumiditySource(),
        scalarArtifactIds: ['rh_surface'],
        vectorArtifactIds: [],
      }),
    })
    expect(nextJob.shouldClearProbeFrame).toBe(true)

    session.reset()
    const resetJob = createLoadJob({
      session,
      target: createTarget({
        scalarArtifactIds: ['tmp_surface'],
        vectorArtifactIds: [],
      }),
    })
    expect(resetJob.shouldClearProbeFrame).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('prefetches through the private request path without committing reusable windows', async () => {
    const session = createForecastDataSession()
    const payload = createScalarPayloadFixture([1, 2, 3, 4])
    const fetchMock = stubFetchArrayBufferOnce(payload)

    await session.prefetch({
      target: createTarget({
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
      target: createTarget({
        forecastHours: ['000'],
        scalarArtifactIds: ['tmp_surface'],
        vectorArtifactIds: [],
      }),
    })
    expect(nextJob.shouldClearProbeFrame).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('suppresses opportunistic prefetch failures', async () => {
    const session = createForecastDataSession()
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('prefetch failed')
    }))

    await expect(session.prefetch({
      target: createTarget({
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
