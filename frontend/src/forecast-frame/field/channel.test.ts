import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createArtifactLoader } from '../../forecast-artifacts'
import {
  FORECAST_LAYERS,
  getAvailableLayers,
  type LayerSpec,
} from '../../forecast-catalog'
import {
  createConfigFixture,
  createFrameManifestFixture,
  createFrameRefFixture,
  createGridFixture,
  createScalarEncodingFixture,
  createScalarProductFixture,
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
  clearFieldFrameCache,
  createFieldChannel,
} from '.'

afterEach(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  clearFieldFrameCache()
})

function layer(manifest: ReturnType<typeof createFrameManifestFixture>, layerId = 'tmp_surface') {
  try {
    return getAvailableLayers(manifest)[layerId]!
  } catch {
    const catalogLayer = FORECAST_LAYERS.find((entry) => entry.id === layerId)
    if (!catalogLayer) throw new Error(`Missing fixture layer ${layerId}`)
    return catalogLayer
  }
}

function fieldChannel(args: {
  manifest: ReturnType<typeof createFrameManifestFixture>
  layerId?: string
  layer?: LayerSpec
}) {
  return createFieldChannel({
    manifest: args.manifest,
    layer: args.layer ?? layer(args.manifest, args.layerId),
    artifacts: createArtifactLoader({
      config: createConfigFixture(),
      manifest: args.manifest,
      signal: createSignalFixture(),
    }),
  })
}

describe('createFieldChannel', () => {
  it('loads direct artifact fields and applies catalog display metadata', async () => {
    const payload = createScalarPayloadFixture([1, 2, 3, 4])
    const fetchMock = stubFetchArrayBufferOnce(payload)

    const manifest = createFrameManifestFixture({
      cycle: '2026041100',
      generatedAt: '2026-04-11T00:00:00Z',
      products: {
        tmp_surface: createScalarProductFixture({
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
          frames: {
            '000': createFrameRefFixture({
              path: 'fields/2026041100/000/tmp_surface.field.i16.bin',
              byteLength: 8,
              sha256: 'x',
            }),
          },
        }),
      },
    })

    const frame = await fieldChannel({ manifest }).load('000')

    expect(frame.layerId).toBe('tmp_surface')
    expect(frame.paletteId).toBe('temperature.air.c.v1')
    expect(frame.displayRange).toEqual([-35, 50])
    expect(frame.grid.nx).toBe(2)
    expect(Array.from(frame.values, (value) => Number(value.toFixed(2)))).toEqual([0.01, 0.02, 0.03, 0.04])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reuses decoded field frames from the in-memory frame cache', async () => {
    const payload = createScalarPayloadFixture([1, 2, 3, 4])
    const fetchMock = stubFetchArrayBufferOnce(payload)
    const manifest = createFrameManifestFixture()
    const channel = fieldChannel({ manifest })

    const firstFrame = await channel.load('000')
    const secondFrame = await channel.load('000')

    expect(secondFrame).toBe(firstFrame)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('derives wind speed fields from vector u/v components', async () => {
    const payload = createVectorPayloadFixture([6, 0, -6, 0], [8, 0, -8, 0])
    const fetchMock = stubFetchArrayBufferOnce(payload)
    const manifest = createFrameManifestFixture({
      scalarProducts: [],
      vectorProducts: ['wind10m_uv'],
    })

    const frame = await fieldChannel({
      manifest,
      layerId: 'wind_speed_surface',
    }).load('000')

    expect(frame.layerId).toBe('wind_speed_surface')
    expect(frame.paletteId).toBe('wind.gust.mps.v1')
    expect(frame.encoding.format).toBe('derived-float32-v1')
    expect(Array.from(frame.values)).toEqual([5, 0, 5, 0])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('loads composite precipitation fields without optional overlays', async () => {
    const payload = createScalarPayloadFixture([100, 200, 300, 400])
    const fetchMock = stubFetchArrayBufferOnce(payload)
    const manifest = createFrameManifestFixture({
      cycle: '2026041200',
      scalarProducts: ['prate_surface'],
      vectorProducts: [],
    })

    const frame = await fieldChannel({
      manifest,
      layerId: 'prate_surface',
    }).load('000')

    expect(frame.layerId).toBe('prate_surface')
    expect(frame.paletteId).toBe('precip.rate.mm_hr.v1')
    expect(Array.from(frame.values)).toEqual([1, 2, 3, 4])
    expect(frame.overlays).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('loads available composite precipitation overlays', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createFetchArrayBufferResponse(createScalarPayloadFixture([100, 200, 300, 400])))
      .mockResolvedValueOnce(createFetchArrayBufferResponse(createScalarPayloadFixture([1, 4, 0, 5])))
      .mockResolvedValueOnce(createFetchArrayBufferResponse(createScalarPayloadFixture([0, 1, 0, 1])))
    vi.stubGlobal('fetch', fetchMock)
    const categoricalEncoding = createScalarEncodingFixture({ scale: 1 })
    const manifest = createFrameManifestFixture({
      cycle: '2026041206',
      products: {
        prate_surface: createScalarProductFixture({
          id: 'prate_surface',
          cycle: '2026041206',
        }),
        precip_type_surface: createScalarProductFixture({
          id: 'precip_type_surface',
          cycle: '2026041206',
          encoding: categoricalEncoding,
        }),
        thunderstorm_mask: createScalarProductFixture({
          id: 'thunderstorm_mask',
          cycle: '2026041206',
          encoding: categoricalEncoding,
        }),
      },
    })

    const frame = await fieldChannel({
      manifest,
      layerId: 'prate_surface',
    }).load('000')

    expect(frame.overlays.map((overlay) => overlay.id)).toEqual(['precip-type', 'thunderstorm'])
    expect(Array.from(frame.overlays[0]!.values)).toEqual([1, 4, 0, 5])
    expect(Array.from(frame.overlays[1]!.values)).toEqual([0, 1, 0, 1])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('loads available composite phase-rate overlays', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createFetchArrayBufferResponse(createScalarPayloadFixture([100, 200, 300, 400])))
      .mockResolvedValueOnce(createFetchArrayBufferResponse(createScalarPayloadFixture([100, 0, 0, 0])))
      .mockResolvedValueOnce(createFetchArrayBufferResponse(createScalarPayloadFixture([0, 200, 0, 0])))
      .mockResolvedValueOnce(createFetchArrayBufferResponse(createScalarPayloadFixture([0, 0, 300, 0])))
    vi.stubGlobal('fetch', fetchMock)
    const manifest = createFrameManifestFixture({
      cycle: '2026041209',
      scalarProducts: ['prate_surface', 'rain_rate_surface', 'snow_rate_surface', 'wintry_mix_rate_surface'],
      vectorProducts: [],
    })

    const frame = await fieldChannel({
      manifest,
      layerId: 'prate_surface',
    }).load('000')

    expect(frame.overlays.map((overlay) => overlay.id)).toEqual([
      'rain-rate',
      'snow-rate',
      'wintry-mix-rate',
    ])
    expect(Array.from(frame.overlays[0]!.values)).toEqual([1, 0, 0, 0])
    expect(Array.from(frame.overlays[1]!.values)).toEqual([0, 2, 0, 0])
    expect(Array.from(frame.overlays[2]!.values)).toEqual([0, 0, 3, 0])
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('falls back to the composite base field when an optional overlay fails to load', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createFetchArrayBufferResponse(createScalarPayloadFixture([100, 200, 300, 400])))
      .mockResolvedValueOnce(createFetchErrorResponse(404, 'Not Found'))
    vi.stubGlobal('fetch', fetchMock)
    const manifest = createFrameManifestFixture({
      cycle: '2026041212',
      scalarProducts: ['prate_surface', 'precip_type_surface'],
      vectorProducts: [],
    })

    const frame = await fieldChannel({
      manifest,
      layerId: 'prate_surface',
    }).load('000')

    expect(Array.from(frame.values)).toEqual([1, 2, 3, 4])
    expect(frame.overlays).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
