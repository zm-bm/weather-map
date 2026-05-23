import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createArtifactLoader } from '../../forecast-artifacts'
import {
  FORECAST_LAYERS,
  FORECAST_LAYERS_BY_ID,
  type LayerSpec,
} from '../../forecast-catalog'
import {
  createActiveRunFixture,
  createConfigFixture,
  createSingleTimeManifestFixture,
  createGridFixture,
  createScalarArtifactFixture,
  createScalarPayloadFixture,
  createSignalFixture,
  createVectorPayloadFixture,
} from '../../test/fixtures'
import {
  stubFetchArrayBufferOnce,
} from '../../test/fetch'
import {
  clearFieldTimeSliceCache,
} from './cache'
import { createFieldChannel } from './channel'

afterEach(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  clearFieldTimeSliceCache()
})

function layer(_manifest: ReturnType<typeof createSingleTimeManifestFixture>, layerId = 'temperature') {
  const catalogLayer = FORECAST_LAYERS_BY_ID[layerId] ??
    FORECAST_LAYERS.find((entry) => entry.id === layerId)
  if (!catalogLayer) throw new Error(`Missing fixture layer ${layerId}`)
  return catalogLayer
}

function fieldChannel(args: {
  manifest: ReturnType<typeof createSingleTimeManifestFixture>
  layerId?: string
  layer?: LayerSpec
}) {
  const activeRun = createActiveRunFixture(args.manifest)
  return createFieldChannel({
    activeRun,
    layer: args.layer ?? layer(args.manifest, args.layerId),
    artifacts: createArtifactLoader({
      config: createConfigFixture(),
      activeRun,
      signal: createSignalFixture(),
    }),
  })
}

describe('createFieldChannel', () => {
  it('loads direct artifact fields and applies catalog display metadata', async () => {
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

    const frame = await fieldChannel({ manifest }).load('000')

    expect(frame.layerId).toBe('temperature')
    expect(frame.paletteId).toBe('temperature.air.c.v1')
    expect(frame.displayRange).toEqual([-35, 50])
    expect(frame.grid.nx).toBe(2)
    expect(Array.from(frame.values, (value) => Number(value.toFixed(2)))).toEqual([0.01, 0.02, 0.03, 0.04])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reuses decoded field frames from the in-memory frame cache', async () => {
    const payload = createScalarPayloadFixture([1, 2, 3, 4])
    const fetchMock = stubFetchArrayBufferOnce(payload)
    const manifest = createSingleTimeManifestFixture()
    const channel = fieldChannel({ manifest })

    const firstFrame = await channel.load('000')
    const secondFrame = await channel.load('000')

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

    const frame = await fieldChannel({
      manifest,
      layerId: 'wind_speed',
    }).load('000')

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

    const frame = await fieldChannel({
      manifest,
      layerId: 'precipitation_rate',
    }).load('000')

    expect(frame.layerId).toBe('precipitation_rate')
    expect(frame.paletteId).toBe('precip.rate.mm_hr.v1')
    expect(Array.from(frame.values)).toEqual([1, 2, 3, 4])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
