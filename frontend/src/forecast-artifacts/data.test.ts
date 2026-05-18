import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ScalarEncodingSpec, VectorEncodingSpec } from '../forecast-manifest'
import { __resetPayloadFrameCacheForTests } from '../forecast-cache/payloadFrameCache'
import { createArtifactLoader } from './data'
import {
  createConfigFixture,
  createSingleTimeManifestFixture,
  createGridFixture,
  createScalarArtifactFixture,
  createScalarPayloadFixture,
  createSignalFixture,
  createVectorArtifactFixture,
  createVectorPayloadFixture,
  createActiveRunFixture,
} from '../test/fixtures'
import { stubFetchArrayBufferOnce } from '../test/fetch'

afterEach(async () => {
  vi.unstubAllGlobals()
  await __resetPayloadFrameCacheForTests()
})

function artifacts(manifest: ReturnType<typeof createSingleTimeManifestFixture>) {
  return createArtifactLoader({
    config: createConfigFixture(),
    activeRun: createActiveRunFixture(manifest),
    signal: createSignalFixture(),
  })
}

describe('scalar payload', () => {
  it('maps loaded scalar payload into frame data', async () => {
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
    const frame = await artifacts(manifest).loadScalar('tmp_surface', '000')

    expect(frame.artifactId).toBe('tmp_surface')
    expect(frame.grid.nx).toBe(2)
    expect(Array.from(frame.values, (value) => Number(value.toFixed(2)))).toEqual([0.01, 0.02, 0.03, 0.04])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/fields/gfs/2026041100/000/tmp_surface.field.i16.bin'
    )
  })

  it('maps loaded big-endian int16 scalar payloads into frame data', async () => {
    const payload = new Uint8Array([0x00, 0x01, 0xff, 0xfe, 0x01, 0x2c, 0xfe, 0x70]).buffer
    const fetchMock = stubFetchArrayBufferOnce(payload)

    const manifest = createSingleTimeManifestFixture({
      artifacts: {
        tmp_surface: createScalarArtifactFixture({
          encoding: {
            id: 'e0',
            format: 'linear-i16-v1',
            dtype: 'int16',
            byteOrder: 'big',
            nodata: -32768,
            scale: 1,
            offset: 0,
            decodeFormula: 'value = stored * scale + offset',
          },
          byteLength: 8,
        }),
      },
    })
    const frame = await artifacts(manifest).loadScalar('tmp_surface', '000')

    expect(Array.from(frame.values)).toEqual([1, -2, 300, -400])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps loaded int8 scalar payloads into frame data', async () => {
    const payload = new Int8Array([-100, 0, 100, -128]).buffer
    const fetchMock = stubFetchArrayBufferOnce(payload)

    const manifest = createSingleTimeManifestFixture({
      artifacts: {
        tmp_surface: createScalarArtifactFixture({
          encoding: {
            id: 'e0',
            format: 'linear-i8-v1',
            dtype: 'int8',
            byteOrder: 'none',
            nodata: -128,
            scale: 0.5,
            offset: 50,
            decodeFormula: 'value = stored * scale + offset',
          },
          byteLength: 4,
        }),
      },
    })
    const frame = await artifacts(manifest).loadScalar('tmp_surface', '000')

    expect(frame.encoding.format).toBe('linear-i8-v1')
    expect(Array.from(frame.values.slice(0, 3))).toEqual([0, 50, 100])
    expect(Number.isNaN(frame.values[3])).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps loaded temperature piecewise payloads into decoded frame data', async () => {
    const payload = new Int8Array([-127, -73, -72, 95]).buffer
    const fetchMock = stubFetchArrayBufferOnce(payload)

    const manifest = createSingleTimeManifestFixture({
      artifacts: {
        tmp_surface: createScalarArtifactFixture({
          encoding: {
            id: 'e0',
            format: 'temp-c-piecewise-i8-v1',
            dtype: 'int8',
            byteOrder: 'none',
            nodata: -128,
          },
          byteLength: 4,
        }),
      },
    })
    const frame = await artifacts(manifest).loadScalar('tmp_surface', '000')

    expect(frame.encoding.format).toBe('temp-c-piecewise-i8-v1')
    expect(Array.from(frame.values)).toEqual([-35, -8, -7.75, 34])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects scalar payloads with non-value components', async () => {
    stubFetchArrayBufferOnce(new Int8Array(12).buffer)
    const manifest = createSingleTimeManifestFixture({
      artifacts: {
        tmp_surface: createScalarArtifactFixture({
          components: ['low', 'medium', 'high'],
          encoding: {
            id: 'e0',
            format: 'linear-i8-v1',
            dtype: 'int8',
            byteOrder: 'none',
            nodata: -128,
            scale: 5,
            offset: 0,
            decodeFormula: 'value = stored * scale + offset',
          },
          byteLength: 12,
        }),
      },
    })

    await expect(
      artifacts(manifest).loadScalar('tmp_surface', '000')
    ).rejects.toThrow('Unsupported scalar components')
  })

  it('rejects scalar payloads with the wrong byte length', async () => {
    const payload = new Int8Array([1, 2, 3]).buffer
    stubFetchArrayBufferOnce(payload)
    const manifest = createSingleTimeManifestFixture({
      artifacts: {
        tmp_surface: createScalarArtifactFixture({
          encoding: {
            id: 'e0',
            format: 'linear-i8-v1',
            dtype: 'int8',
            byteOrder: 'none',
            nodata: -128,
            scale: 0.5,
            offset: 50,
            decodeFormula: 'value = stored * scale + offset',
          },
          byteLength: 3,
        }),
      },
    })

    await expect(
      artifacts(manifest).loadScalar('tmp_surface', '000')
    ).rejects.toThrow('Scalar payload byte length mismatch')
  })

  it('rejects unsupported scalar encodings in artifact loads', async () => {
    stubFetchArrayBufferOnce(new Int8Array([0, 1, 2, 3]).buffer)
    const manifest = createSingleTimeManifestFixture({
      artifacts: {
        tmp_surface: createScalarArtifactFixture({
          encoding: {
            id: 'e0',
            format: 'bad-format',
            dtype: 'int8',
            byteOrder: 'none',
            nodata: -128,
          } as unknown as ScalarEncodingSpec,
          byteLength: 4,
        }),
      },
    })

    await expect(
      artifacts(manifest).loadScalar('tmp_surface', '000')
    ).rejects.toThrow('Unsupported scalar format')
  })

  it('rejects scalar artifact loads for artifacts assigned to another kind', async () => {
    const manifest = createSingleTimeManifestFixture({
      artifacts: {
        tmp_surface: {
          ...createVectorArtifactFixture(),
          id: 'tmp_surface',
        },
      },
      scalarArtifactIds: ['tmp_surface'],
      vectorArtifactIds: [],
    })
    await expect(
      artifacts(manifest).loadScalar('tmp_surface', '000')
    ).rejects.toThrow('Artifact tmp_surface is not scalar')
  })
})

describe('vector payload', () => {
  it('maps loaded vector payloads into artifact data', async () => {
    const payload = createVectorPayloadFixture([1, -2, 3, -4], [-5, 6, -7, 8])
    const fetchMock = stubFetchArrayBufferOnce(payload)
    const manifest = createSingleTimeManifestFixture({
      artifacts: {
        wind10m_uv: createVectorArtifactFixture(),
      },
    })

    const frame = await artifacts(manifest).loadVector('wind10m_uv', '0')

    expect(frame.artifactId).toBe('wind10m_uv')
    expect(frame.hourToken).toBe('000')
    expect(Array.from(frame.u)).toEqual([1, -2, 3, -4])
    expect(Array.from(frame.v)).toEqual([-5, 6, -7, 8])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('validates vector metadata before fetching payloads', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const baseEncoding = createVectorArtifactFixture().encoding
    const manifest = createSingleTimeManifestFixture({
      artifacts: {
        wind10m_uv: createVectorArtifactFixture({
          encoding: {
            ...baseEncoding,
            dtype: 'int16',
          } as unknown as VectorEncodingSpec,
        }),
      },
    })

    await expect(
      artifacts(manifest).loadVector('wind10m_uv', '000')
    ).rejects.toThrow('Unsupported vector dtype')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects vector loads for missing artifacts, missing frames, and wrong artifact kind', async () => {
    await expect(
      artifacts(createSingleTimeManifestFixture()).loadVector('missing_wind', '000')
    ).rejects.toThrow('No vector artifact metadata for model=gfs artifact=missing_wind')

    const missingTimeManifest = createSingleTimeManifestFixture({
      forecastHours: ['003'],
      artifacts: {
        wind10m_uv: createVectorArtifactFixture(),
      },
    })
    await expect(
      artifacts(missingTimeManifest).loadVector('wind10m_uv', '000')
    ).rejects.toThrow('No vector frame ref for model=gfs artifact=wind10m_uv hour=000')

    await expect(
      artifacts(createSingleTimeManifestFixture({
        artifacts: {
          wind10m_uv: {
            ...createScalarArtifactFixture(),
            id: 'wind10m_uv',
          },
        },
      })).loadVector('wind10m_uv', '000')
    ).rejects.toThrow('Artifact wind10m_uv is not vector')
  })
})
