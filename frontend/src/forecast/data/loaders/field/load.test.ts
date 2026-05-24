import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createArtifactLoader } from '@/forecast/artifacts'
import {
  createActiveRunFixture,
  createConfigFixture,
  createFieldLayerSourceFixture,
  createSingleTimeManifestFixture,
  createGridFixture,
  createScalarArtifactFixture,
  createScalarPayloadFixture,
  createSignalFixture,
  createVectorPayloadFixture,
} from '@/test/fixtures'
import {
  stubFetchArrayBufferOnce,
} from '@/test/fetch'
import type { ForecastDataTarget } from '../../target'
import { clearFieldTimeSliceCache, createFieldDataLoad } from './load'

afterEach(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  clearFieldTimeSliceCache()
})

function fieldLoad(args: {
  manifest: ReturnType<typeof createSingleTimeManifestFixture>
  source?: ForecastDataTarget['layerSource']
}) {
  const activeRun = createActiveRunFixture(args.manifest)
  const source = args.source ?? createFieldLayerSourceFixture()
  if (source.kind !== 'field') throw new Error('Expected field source fixture')
  const load = createFieldDataLoad({
    activeRun,
    source,
    artifacts: createArtifactLoader({
      config: createConfigFixture(),
      activeRun,
      signal: createSignalFixture(),
    }),
  })
  if (load == null) throw new Error('Expected field data load fixture')
  return load
}

function windSpeedSource(): ForecastDataTarget['layerSource'] {
  return createFieldLayerSourceFixture({
    layerId: 'wind_speed',
    paletteId: 'wind.gust.mps.v1',
    displayRange: [0, 55],
    fieldSource: {
      kind: 'derived',
      artifactId: 'wind10m_uv',
      recipe: 'wind-speed',
    },
  })
}

function precipitationRateSource(): ForecastDataTarget['layerSource'] {
  return createFieldLayerSourceFixture({
    layerId: 'precipitation_rate',
    paletteId: 'precip.rate.mm_hr.v1',
    displayRange: [0, 50],
    fieldSource: {
      kind: 'scalar',
      artifactId: 'prate_surface',
    },
  })
}

describe('createFieldDataLoad', () => {
  it('loads direct artifact fields and applies source display metadata', async () => {
    const payload = createScalarPayloadFixture([1, 2, 3, 4])
    const fetchMock = stubFetchArrayBufferOnce(payload)

    const manifest = createSingleTimeManifestFixture({
      cycle: '2026041100',
      generatedAt: '2026-04-11T00:00:00Z',
      artifacts: {
        tmp_surface: createScalarArtifactFixture({
          grid: createGridFixture({
            crs: 'EPSG:4326',
            nx: 2,
            ny: 2,
            lon0: 0,
            lat0: 0,
            dx: 1,
            dy: -1,
            origin: 'cell_center',
            layout: 'row_major',
            xWrap: 'repeat',
            yMode: 'clamp',
          }),
          byteLength: 8,
        }),
      },
    })

    const load = fieldLoad({ manifest })
    const frame = await load.loadTimeSlice('000')

    expect(frame.layerId).toBe('temperature')
    expect(frame.paletteId).toBe('temperature.air.c.v1')
    expect(frame.displayRange).toEqual([-35, 50])
    expect(frame.grid.nx).toBe(2)
    expect(Array.from(frame.values, (value) => Number(value.toFixed(2)))).toEqual([0.01, 0.02, 0.03, 0.04])
    expect(load.probeField?.projectTimeSlice(frame)).toBe(frame)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reuses decoded field frames from the in-memory frame cache', async () => {
    const payload = createScalarPayloadFixture([1, 2, 3, 4])
    const fetchMock = stubFetchArrayBufferOnce(payload)
    const manifest = createSingleTimeManifestFixture()
    const load = fieldLoad({ manifest })

    const firstFrame = await load.loadTimeSlice('000')
    const secondFrame = await load.loadTimeSlice('000')

    expect(secondFrame).toBe(firstFrame)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('derives wind speed fields from vector u/v components', async () => {
    const payload = createVectorPayloadFixture([6, 0, -6, 0], [8, 0, -8, 0])
    const fetchMock = stubFetchArrayBufferOnce(payload)
    const manifest = createSingleTimeManifestFixture({
      scalarArtifactIds: [],
      vectorArtifactIds: ['wind10m_uv'],
    })

    const frame = await fieldLoad({
      manifest,
      source: windSpeedSource(),
    }).loadTimeSlice('000')

    expect(frame.layerId).toBe('wind_speed')
    expect(frame.paletteId).toBe('wind.gust.mps.v1')
    expect(frame.encoding.format).toBe('derived-float32-v1')
    expect(Array.from(frame.values)).toEqual([5, 0, 5, 0])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('loads precipitation rate as a direct scalar field', async () => {
    const payload = createScalarPayloadFixture([100, 200, 300, 400])
    const fetchMock = stubFetchArrayBufferOnce(payload)
    const manifest = createSingleTimeManifestFixture({
      cycle: '2026041200',
      scalarArtifactIds: ['prate_surface'],
      vectorArtifactIds: [],
    })

    const frame = await fieldLoad({
      manifest,
      source: precipitationRateSource(),
    }).loadTimeSlice('000')

    expect(frame.layerId).toBe('precipitation_rate')
    expect(frame.paletteId).toBe('precip.rate.mm_hr.v1')
    expect(Array.from(frame.values)).toEqual([1, 2, 3, 4])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
