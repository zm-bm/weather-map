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
  createScalarEncodingFixture,
  createScalarArtifactFixture,
  createScalarPayloadFixture,
  createSignalFixture,
  createVectorPayloadFixture,
} from '../../test/fixtures'
import {
  createFetchArrayBufferResponse,
  createFetchErrorResponse,
  stubFetchArrayBufferOnce,
} from '../../test/fetch'
import {
  clearFieldTimeSliceCache,
  createFieldChannel,
} from '.'

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

  it('loads composite precipitation fields without optional overlays', async () => {
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
    expect(frame.overlays).toEqual([])
    expect(frame.classifiedColoring?.classifierOverlayId).toBe('precip-type')
    expect(frame.classifiedColoring?.classes.map((entry) => entry.values)).toEqual([[1], [4], [2, 3, 5]])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('loads available composite precipitation overlays', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createFetchArrayBufferResponse(createScalarPayloadFixture([100, 200, 300, 400])))
      .mockResolvedValueOnce(createFetchArrayBufferResponse(createScalarPayloadFixture([1, 4, 0, 5])))
    vi.stubGlobal('fetch', fetchMock)
    const categoricalEncoding = createScalarEncodingFixture({ scale: 1 })
    const manifest = createSingleTimeManifestFixture({
      cycle: '2026041206',
      artifacts: {
        prate_surface: createScalarArtifactFixture({
          id: 'prate_surface',
          cycle: '2026041206',
        }),
        precip_type_surface: createScalarArtifactFixture({
          id: 'precip_type_surface',
          cycle: '2026041206',
          encoding: categoricalEncoding,
        }),
      },
    })

    const frame = await fieldChannel({
      manifest,
      layerId: 'precipitation_rate',
    }).load('000')

    expect(frame.overlays.map((overlay) => overlay.id)).toEqual(['precip-type'])
    expect(Array.from(frame.overlays[0]!.values)).toEqual([1, 4, 0, 5])
    expect(frame.classifiedColoring?.classes).toHaveLength(3)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('falls back to the composite base field when an optional overlay fails to load', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createFetchArrayBufferResponse(createScalarPayloadFixture([100, 200, 300, 400])))
      .mockResolvedValueOnce(createFetchErrorResponse(404, 'Not Found'))
    vi.stubGlobal('fetch', fetchMock)
    const manifest = createSingleTimeManifestFixture({
      cycle: '2026041212',
      scalarArtifactIds: ['prate_surface', 'precip_type_surface'],
      vectorArtifactIds: [],
    })

    const frame = await fieldChannel({
      manifest,
      layerId: 'precipitation_rate',
    }).load('000')

    expect(Array.from(frame.values)).toEqual([1, 2, 3, 4])
    expect(frame.overlays).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
