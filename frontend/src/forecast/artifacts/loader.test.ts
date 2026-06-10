import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ScalarEncodingSpec, VectorEncodingSpec } from '@/forecast/manifest'
import { __resetPayloadCacheForTests } from './payloadCache'
import { createArtifactLoader } from './loader'
import {
  createConfigFixture,
  createActiveRunFixture,
  createSingleTimeManifestFixture,
  createGridFixture,
  createScalarArtifactFixture,
  createScalarPayloadFixture,
  createSignalFixture,
  createVectorArtifactFixture,
  createVectorEncodingFixture,
  createVectorPayloadFixture,
} from '@/test/fixtures'
import { stubFetchArrayBufferOnce } from '@/test/fetch'

afterEach(async () => {
  vi.unstubAllGlobals()
  await __resetPayloadCacheForTests()
})

type TestManifest = ReturnType<typeof createSingleTimeManifestFixture>

function artifacts(manifest: TestManifest) {
  return createArtifactLoader({
    config: createConfigFixture(),
    activeRun: createActiveRunFixture(manifest),
    signal: createSignalFixture(),
  })
}

function loadRasterBands(
  manifest: TestManifest,
  artifactId: string,
  bandIds: readonly [string, ...string[]],
  options?: Parameters<ReturnType<typeof artifacts>['loadRawRasterBands']>[3],
) {
  return artifacts(manifest).loadRawRasterBands(artifactId, '000', bandIds, options)
}

function scalarManifest(
  artifact = createScalarArtifactFixture({ id: 'tmp_surface' }),
): TestManifest {
  return createSingleTimeManifestFixture({
    artifacts: {
      [artifact.id]: artifact,
    },
  })
}

function vectorManifest(
  artifact = createVectorArtifactFixture({ id: 'wind10m_uv', components: ['u', 'v'] }),
): TestManifest {
  return createSingleTimeManifestFixture({
    artifacts: {
      [artifact.id]: artifact,
    },
  })
}

describe('artifact capabilities', () => {
  it('reports supported scalar and vector-component artifacts', () => {
    const loader = artifacts(createSingleTimeManifestFixture({
      artifacts: {
        tmp_surface: createScalarArtifactFixture({ id: 'tmp_surface' }),
        wind10m_uv: createVectorArtifactFixture({
          id: 'wind10m_uv',
          components: ['u', 'v'],
        }),
        precip_type_surface: createVectorArtifactFixture({
          id: 'precip_type_surface',
          components: ['snow_frac', 'mix_frac'],
        }),
      },
    }))

    expect(loader.canLoadRasterBands('tmp_surface', ['value'])).toBe(true)
    expect(loader.canLoadRasterBands('tmp_surface', [] as unknown as ['value'])).toBe(false)
    expect(loader.canLoadRasterBands('tmp_surface', ['low'])).toBe(false)
    expect(loader.canLoadRasterBands('wind10m_uv', ['u', 'v'])).toBe(true)
    expect(loader.canLoadRasterBands('wind10m_uv', ['v', 'u'])).toBe(false)
    expect(loader.canLoadRasterBands('wind10m_uv', ['v', 'u'], { order: 'by-name' })).toBe(true)
    expect(loader.canLoadRasterBands('precip_type_surface', ['snow_frac', 'mix_frac'])).toBe(true)
    expect(loader.canLoadRasterBands('precip_type_surface', ['rain_frac'])).toBe(false)
    expect(loader.canLoadRasterBands('missing', ['snow_frac'])).toBe(false)
  })
})

describe('scalar payload', () => {
  it('maps loaded scalar payload into raster-band data', async () => {
    const payload = createScalarPayloadFixture([1, 2, 3, 4])
    const fetchMock = stubFetchArrayBufferOnce(payload)

    const manifest = createSingleTimeManifestFixture({
      cycle: '2026041100',
      generated_at: '2026-04-11T00:00:00Z',
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
            x_wrap: 'repeat',
            y_mode: 'clamp',
          }),
          byte_length: 4,
        }),
      },
    })
    const frame = await loadRasterBands(manifest, 'tmp_surface', ['value'])

    expect(frame.artifactId).toBe('tmp_surface')
    expect(frame.grid.nx).toBe(2)
    expect(frame.bandIds).toEqual(['value'])
    expect(Array.from(frame.bands[0] ?? [])).toEqual([1, 2, 3, 4])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/runs/gfs/2026041100/20260413T120000Z-abcdef12/payloads/000/tmp_surface.i8.bin'
    )
  })

  it('loads raw scalar payloads as stored int8 values', async () => {
    const payload = new Int8Array([-100, 0, 100, -128]).buffer
    const fetchMock = stubFetchArrayBufferOnce(payload)

    const manifest = scalarManifest(createScalarArtifactFixture({
      encoding: {
        id: 'e0',
        format: 'linear-i8-v1',
        dtype: 'int8',
        byte_order: 'none',
        nodata: -128,
        scale: 0.5,
        offset: 50,
        decode_formula: 'value = stored * scale + offset',
      },
      byte_length: 4,
    }))
    const frame = await loadRasterBands(manifest, 'tmp_surface', ['value'])

    expect(frame.encoding.format).toBe('linear-i8-v1')
    expect(Array.from(frame.bands[0] ?? [])).toEqual([-100, 0, 100, -128])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('loads temperature piecewise payloads as stored int8 values', async () => {
    const payload = new Int8Array([-127, -73, -72, 95]).buffer
    const fetchMock = stubFetchArrayBufferOnce(payload)

    const manifest = scalarManifest(createScalarArtifactFixture({
      encoding: {
        id: 'e0',
        format: 'temp-c-piecewise-i8-v1',
        dtype: 'int8',
        byte_order: 'none',
        nodata: -128,
      },
      byte_length: 4,
    }))
    const frame = await loadRasterBands(manifest, 'tmp_surface', ['value'])

    expect(frame.encoding.format).toBe('temp-c-piecewise-i8-v1')
    expect(Array.from(frame.bands[0] ?? [])).toEqual([-127, -73, -72, 95])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects scalar payloads with non-value components', async () => {
    stubFetchArrayBufferOnce(new Int8Array(12).buffer)
    const manifest = scalarManifest(createScalarArtifactFixture({
      components: ['low', 'medium', 'high'],
      encoding: {
        id: 'e0',
        format: 'linear-i8-v1',
        dtype: 'int8',
        byte_order: 'none',
        nodata: -128,
        scale: 5,
        offset: 0,
        decode_formula: 'value = stored * scale + offset',
      },
      byte_length: 12,
    }))

    await expect(
      loadRasterBands(manifest, 'tmp_surface', ['value'])
    ).rejects.toThrow('Unsupported scalar components')
  })

  it('rejects scalar payloads with the wrong byte length', async () => {
    const payload = new Int8Array([1, 2, 3]).buffer
    stubFetchArrayBufferOnce(payload)
    const manifest = scalarManifest(createScalarArtifactFixture({
      encoding: {
        id: 'e0',
        format: 'linear-i8-v1',
        dtype: 'int8',
        byte_order: 'none',
        nodata: -128,
        scale: 0.5,
        offset: 50,
        decode_formula: 'value = stored * scale + offset',
      },
      byte_length: 3,
    }))

    await expect(
      loadRasterBands(manifest, 'tmp_surface', ['value'])
    ).rejects.toThrow('Scalar payload byte length mismatch')
  })

  it('rejects unsupported scalar encodings in artifact loads', async () => {
    stubFetchArrayBufferOnce(new Int8Array([0, 1, 2, 3]).buffer)
    const manifest = scalarManifest(createScalarArtifactFixture({
      encoding: {
        id: 'e0',
        format: 'bad-format',
        dtype: 'int8',
        byte_order: 'none',
        nodata: -128,
      } as unknown as ScalarEncodingSpec,
      byte_length: 4,
    }))

    await expect(
      loadRasterBands(manifest, 'tmp_surface', ['value'])
    ).rejects.toThrow('Unsupported scalar format')
  })
})

describe('vector payload', () => {
  it('maps loaded generic vector components into raw raster bands', async () => {
    const payload = createVectorPayloadFixture([-127, 0, 127, -128], [-127, -64, 0, 127])
    const fetchMock = stubFetchArrayBufferOnce(payload)
    const manifest = vectorManifest(createVectorArtifactFixture({
      id: 'precip_type_surface',
      units: 'fraction',
      components: ['snow_frac', 'mix_frac'],
      encoding: {
        id: 'precip_type_surface_i8_frac_v1',
        format: 'linear-i8-v1',
        dtype: 'int8',
        byte_order: 'none',
        nodata: -128,
        scale: 1 / 254,
        offset: 0.5,
        decode_formula: 'value = stored * scale + offset',
      },
    }))

    const frame = await artifacts(manifest).loadRawRasterBands(
      'precip_type_surface',
      '0',
      ['snow_frac', 'mix_frac']
    )

    expect(frame.artifactId).toBe('precip_type_surface')
    expect(frame.bandIds).toEqual(['snow_frac', 'mix_frac'])
    expect(Array.from(frame.bands[0] ?? [])).toEqual([-127, 0, 127, -128])
    expect(Array.from(frame.bands[1] ?? [])).toEqual([-127, -64, 0, 127])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps loaded generic vector components into raw byte arrays through the raster-band API', async () => {
    const payload = new Int8Array([
      0, 25, -128, 50,
      10, 0, 20, -128,
      50, 25, -128, -128,
    ]).buffer
    const fetchMock = stubFetchArrayBufferOnce(payload)
    const manifest = vectorManifest(createVectorArtifactFixture({
      id: 'cloud_layers',
      units: '%',
      parameter: 'cloud_layers',
      level: 'cloud layers',
      components: ['low', 'middle', 'high'],
      encoding: {
        id: 'cloud_layers_vector_i8_4pct_v1',
        format: 'linear-i8-v1',
        dtype: 'int8',
        byte_order: 'none',
        nodata: -128,
        scale: 4,
        offset: 0,
        decode_formula: 'value = stored * scale + offset',
      },
    }))

    const frame = await artifacts(manifest).loadRawRasterBands('cloud_layers', '0', ['low', 'middle', 'high'])

    expect(frame.artifactId).toBe('cloud_layers')
    expect(frame.bandIds).toEqual(['low', 'middle', 'high'])
    expect(Array.from(frame.bands[0]!)).toEqual([0, 25, -128, 50])
    expect(Array.from(frame.bands[1]!)).toEqual([10, 0, 20, -128])
    expect(Array.from(frame.bands[2]!)).toEqual([50, 25, -128, -128])
    expect(frame.bands[0]!.buffer).toBe(payload)
    expect(frame.bands[1]!.buffer).toBe(payload)
    expect(frame.bands[2]!.buffer).toBe(payload)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('loads raw vector components through the raster-band API in requested order', async () => {
    const payload = new Int8Array([
      0, 25, -128, 50,
      10, 0, 20, -128,
      50, 25, -128, -128,
    ]).buffer
    stubFetchArrayBufferOnce(payload)
    const manifest = vectorManifest(createVectorArtifactFixture({
      id: 'cloud_layers',
      components: ['low', 'middle', 'high'],
      encoding: createVectorEncodingFixture({ scale: 4 }),
    }))

    const frame = await artifacts(manifest).loadRawRasterBands(
      'cloud_layers',
      '0',
      ['high', 'low'],
      { order: 'by-name' }
    )

    expect(frame.artifactId).toBe('cloud_layers')
    expect(frame.bandIds).toEqual(['high', 'low'])
    expect(Array.from(frame.bands[0]!)).toEqual([50, 25, -128, -128])
    expect(Array.from(frame.bands[1]!)).toEqual([0, 25, -128, 50])
    expect(frame.bands[0]!.buffer).toBe(payload)
    expect(frame.bands[1]!.buffer).toBe(payload)
  })

  it('rejects missing and misordered raster bands', async () => {
    stubFetchArrayBufferOnce(new Int8Array(8).buffer)
    const manifest = vectorManifest(createVectorArtifactFixture({
      components: ['u', 'v'],
    }))

    await expect(
      loadRasterBands(manifest, 'wind10m_uv', ['v', 'u'])
    ).rejects.toThrow('requires components v, u; got u, v')

    await expect(
      loadRasterBands(manifest, 'wind10m_uv', ['u', 'missing'], { order: 'by-name' })
    ).rejects.toThrow('missing raster bands')
  })

  it('sizes generic vector payloads by manifest component count', async () => {
    const payload = new Int8Array([
      0, 1, 2, 3,
      4, 5, 6, 7,
      8, 9, 10, 11,
    ]).buffer
    stubFetchArrayBufferOnce(payload)
    const manifest = vectorManifest(createVectorArtifactFixture({
      id: 'triple_vector',
      components: ['a', 'b', 'c'],
      encoding: createVectorEncodingFixture({ scale: 0.5 }),
    }))

    const frame = await artifacts(manifest).loadRawRasterBands(
      'triple_vector',
      '000',
      ['a', 'b', 'c']
    )

    expect(Array.from(frame.bands[2] ?? [])).toEqual([8, 9, 10, 11])
  })

  it('rejects vector payloads that do not match the manifest grid and component layout', async () => {
    stubFetchArrayBufferOnce(new Int8Array(8).buffer)
    const manifest = vectorManifest(createVectorArtifactFixture({
      id: 'triple_vector',
      components: ['a', 'b', 'c'],
      byte_length: 8,
    }))

    await expect(
      loadRasterBands(manifest, 'triple_vector', ['a', 'b', 'c'])
    ).rejects.toThrow('Vector component payload byte length mismatch')
  })

  it('validates vector metadata before fetching payloads', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const baseEncoding = createVectorArtifactFixture().encoding
    const manifest = vectorManifest(createVectorArtifactFixture({
      encoding: {
        ...baseEncoding,
        byte_order: 'big',
      } as unknown as VectorEncodingSpec,
    }))

    await expect(
      loadRasterBands(manifest, 'wind10m_uv', ['u', 'v'])
    ).rejects.toThrow('Unsupported vector byte order')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects raster-band loads for missing artifacts, missing frames, and wrong artifact kind', async () => {
    await expect(
      artifacts(createSingleTimeManifestFixture()).loadRawRasterBands('tmp_surface', '000', [] as unknown as ['value'])
    ).rejects.toThrow('Raster band request requires at least one band')

    await expect(
      loadRasterBands(createSingleTimeManifestFixture(), 'missing_wind', ['u', 'v'])
    ).rejects.toThrow('Missing artifact missing_wind')

    const missingTimeManifest = createSingleTimeManifestFixture({
      frameIds: ['003'],
      artifacts: {
        wind10m_uv: createVectorArtifactFixture(),
      },
    })
    await expect(
      loadRasterBands(missingTimeManifest, 'wind10m_uv', ['u', 'v'])
    ).rejects.toThrow('No vector frame ref for dataset_id=gfs artifact=wind10m_uv frame=000')

    await expect(
      loadRasterBands(createSingleTimeManifestFixture({
        artifacts: {
          wind10m_uv: {
            ...createScalarArtifactFixture(),
            id: 'wind10m_uv',
          },
        },
      }), 'wind10m_uv', ['u', 'v'])
    ).rejects.toThrow('Scalar artifact wind10m_uv only supports raster band value')
  })
})
