import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createArtifactLoader } from '../../forecast-artifacts'
import {
  asLayerId,
  FORECAST_LAYERS,
  getAvailableLayers,
  type LayerSpec,
} from '../../forecast-catalog'
import { asProductId } from '../../manifest'
import {
  createConfigFixture,
  createFrameManifestFixture,
  createFrameRefFixture,
  createGridFixture,
  createScalarProductFixture,
  createScalarPayloadFixture,
  createSignalFixture,
  createVectorPayloadFixture,
} from '../../test/fixtures'
import { stubFetchArrayBufferOnce } from '../../test/fetch'
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

  it('rejects composite sources until composite field loading is implemented', async () => {
    const baseLayer = layer(createFrameManifestFixture())
    const compositeLayer: LayerSpec = {
      ...baseLayer,
      id: asLayerId('test_composite'),
      source: {
        kind: 'composite',
        base: { kind: 'artifact', artifactId: asProductId('tmp_surface') },
        overlays: [],
      },
    }

    await expect(
      fieldChannel({
        manifest: createFrameManifestFixture(),
        layer: compositeLayer,
      }).load('000')
    ).rejects.toThrow('Unsupported layer source')
  })
})
