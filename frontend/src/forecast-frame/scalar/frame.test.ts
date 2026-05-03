import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ScalarEncodingSpec } from '../../manifest'
import {
  decodeCloudLayerPayload,
  decodeScalarPayloadInt16,
  decodeScalarPayloadInt8,
  decodeScalarPayloadToValues,
  decodeTemperaturePiecewiseStoredValue,
} from './codec'
import { clearDecodedScalarFrameCache, loadScalarFrame } from './frame'
import {
  createConfigFixture,
  createFrameRefFixture,
  createFrameManifestFixture,
  createGridFixture,
  createScalarProductFixture,
  createScalarPayloadFixture,
  createSignalFixture,
} from '../../test/fixtures'
import { stubFetchArrayBufferOnce } from '../../test/fetch'

afterEach(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  clearDecodedScalarFrameCache()
})

describe('scalar payload', () => {
  it('decodes little-endian int16 payloads', () => {
    const payload = new Int16Array([1, -2, 300, -400]).buffer
    expect(Array.from(decodeScalarPayloadInt16(payload, 'little'))).toEqual([1, -2, 300, -400])
  })

  it('decodes big-endian int16 payloads', () => {
    const payload = new Uint8Array([0x00, 0x01, 0xff, 0xfe, 0x01, 0x2c, 0xfe, 0x70]).buffer
    expect(Array.from(decodeScalarPayloadInt16(payload, 'big'))).toEqual([1, -2, 300, -400])
  })

  it('decodes int8 payloads', () => {
    const payload = new Int8Array([-100, 0, 100, -128]).buffer
    expect(Array.from(decodeScalarPayloadInt8(payload, 'none'))).toEqual([-100, 0, 100, -128])
  })

  it('decodes linear scalar payloads into values before rendering', () => {
    const payload = new Int8Array([-100, 0, 100, -128]).buffer
    const values = decodeScalarPayloadToValues(payload, {
      id: 'e0',
      format: 'linear-i8-v1',
      dtype: 'int8',
      byteOrder: 'none',
      nodata: -128,
      scale: 0.5,
      offset: 50,
      decodeFormula: 'value = stored * scale + offset',
    })

    expect(Array.from(values.slice(0, 3))).toEqual([0, 50, 100])
    expect(Number.isNaN(values[3])).toBe(true)
  })

  it('decodes temperature piecewise payloads into Celsius values', () => {
    const payload = new Int8Array([-127, -73, -72, 95, 96, 127, -128]).buffer
    const values = decodeScalarPayloadToValues(payload, {
      id: 'e0',
      format: 'temp-c-piecewise-i8-v1',
      dtype: 'int8',
      byteOrder: 'none',
      nodata: -128,
    })

    expect(Array.from(values.slice(0, 6))).toEqual([-35, -8, -7.75, 34, 34.5, 50])
    expect(Number.isNaN(values[6])).toBe(true)
    expect(decodeTemperaturePiecewiseStoredValue(-127)).toBe(-35)
    expect(decodeTemperaturePiecewiseStoredValue(127)).toBe(50)
  })

  it('decodes packed cloud layer payloads into component arrays and max coverage values', () => {
    const payload = new Int8Array([
      0, 1, 20, -128,
      2, 11, 16, 5,
      3, 9, 13, 19,
    ]).buffer
    const decoded = decodeCloudLayerPayload(payload, {
      id: 'e0',
      format: 'linear-i8-v1',
      dtype: 'int8',
      byteOrder: 'none',
      nodata: -128,
      scale: 5,
      offset: 0,
      decodeFormula: 'value = stored * scale + offset',
      components: ['low', 'medium', 'high'],
    })

    expect(Array.from(decoded.cloudLayers!.low.slice(0, 3))).toEqual([0, 5, 100])
    expect(Number.isNaN(decoded.cloudLayers!.low[3])).toBe(true)
    expect(Array.from(decoded.cloudLayers!.medium)).toEqual([10, 55, 80, 25])
    expect(Array.from(decoded.cloudLayers!.high)).toEqual([15, 45, 65, 95])
    expect(Array.from(decoded.values)).toEqual([15, 55, 100, 95])
  })

  it('rejects packed cloud layer payloads whose byte length cannot be split into components', () => {
    expect(() => decodeCloudLayerPayload(new Int8Array([0, 1, 2, 3]).buffer, {
      id: 'e0',
      format: 'linear-i8-v1',
      dtype: 'int8',
      byteOrder: 'none',
      nodata: -128,
      scale: 5,
      offset: 0,
      decodeFormula: 'value = stored * scale + offset',
      components: ['low', 'medium', 'high'],
    })).toThrow('Invalid cloud layer payload byte length')
  })

  it('maps loaded scalar payload into frame data', async () => {
    const payload = createScalarPayloadFixture([1, 2, 3, 4])
    const fetchMock = stubFetchArrayBufferOnce(payload)

    const frame = await loadScalarFrame({
      config: createConfigFixture(),
      manifest: createFrameManifestFixture({
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
                path: 'fields/2026041100/000/tmp_surface.scalar.i16.bin',
                byteLength: 8,
                sha256: 'x',
              }),
            },
          }),
        },
      }),
      variable: 'tmp_surface',
      hourToken: '000',
      signal: createSignalFixture(),
    })

    expect(frame.variableId).toBe('tmp_surface')
    expect(frame.grid.nx).toBe(2)
    expect(Array.from(frame.values, (value) => Number(value.toFixed(2)))).toEqual([0.01, 0.02, 0.03, 0.04])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reuses decoded scalar frames from the in-memory frame cache', async () => {
    const payload = createScalarPayloadFixture([1, 2, 3, 4])
    const fetchMock = stubFetchArrayBufferOnce(payload)
    const manifest = createFrameManifestFixture()
    const args = {
      config: createConfigFixture(),
      manifest,
      variable: 'tmp_surface',
      hourToken: '000',
      signal: createSignalFixture(),
    }

    const firstFrame = await loadScalarFrame(args)
    const secondFrame = await loadScalarFrame(args)

    expect(secondFrame).toBe(firstFrame)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('evicts the oldest decoded scalar frame when the frame cache exceeds its limit', async () => {
    const payload = createScalarPayloadFixture([1, 2, 3, 4])
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => payload,
    })
    vi.stubGlobal('fetch', fetchMock)
    const hourTokens = ['000', '001', '002', '003', '004', '005', '006']
    const manifest = createFrameManifestFixture({
      cycle: '2026041100',
      forecastHours: hourTokens,
      products: {
        tmp_surface: createScalarProductFixture({
          cycle: '2026041100',
          forecastHours: hourTokens,
          frames: Object.fromEntries(hourTokens.map((hourToken) => [
            hourToken,
            createFrameRefFixture({
              path: `fields/2026041100/${hourToken}/tmp_surface.scalar.i16.bin`,
              sha256: `sha-${hourToken}`,
            }),
          ])),
        }),
      },
    })

    const loadedFrames = []
    for (const hourToken of hourTokens) {
      loadedFrames.push(await loadScalarFrame({
        config: createConfigFixture(),
        manifest,
        variable: 'tmp_surface',
        hourToken,
        signal: createSignalFixture(),
      }))
    }

    const reloadedFirstFrame = await loadScalarFrame({
      config: createConfigFixture(),
      manifest,
      variable: 'tmp_surface',
      hourToken: '000',
      signal: createSignalFixture(),
    })

    expect(reloadedFirstFrame).not.toBe(loadedFrames[0])
    expect(fetchMock).toHaveBeenCalledTimes(7)
  })

  it('maps loaded int8 scalar payloads into frame data', async () => {
    const payload = new Int8Array([-100, 0, 100, -128]).buffer
    const fetchMock = stubFetchArrayBufferOnce(payload)

    const frame = await loadScalarFrame({
      config: createConfigFixture(),
      manifest: createFrameManifestFixture({
        products: {
          tmp_surface: createScalarProductFixture({
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
            frames: {
              '000': createFrameRefFixture({
                path: 'fields/2026041100/000/tmp_surface.temp-piecewise.scalar.i8.bin',
                byteLength: 4,
                sha256: 'x',
              }),
            },
          }),
        },
      }),
      variable: 'tmp_surface',
      hourToken: '000',
      signal: createSignalFixture(),
    })

    expect(frame.encoding.format).toBe('linear-i8-v1')
    expect(Array.from(frame.values.slice(0, 3))).toEqual([0, 50, 100])
    expect(Number.isNaN(frame.values[3])).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps loaded temperature piecewise payloads into decoded frame data', async () => {
    const payload = new Int8Array([-127, -73, -72, 95]).buffer
    const fetchMock = stubFetchArrayBufferOnce(payload)

    const frame = await loadScalarFrame({
      config: createConfigFixture(),
      manifest: createFrameManifestFixture({
        products: {
          tmp_surface: createScalarProductFixture({
            encoding: {
              id: 'e0',
              format: 'temp-c-piecewise-i8-v1',
              dtype: 'int8',
              byteOrder: 'none',
              nodata: -128,
            },
            frames: {
              '000': createFrameRefFixture({
                path: 'fields/2026041100/000/tmp_surface.scalar.i8.bin',
                byteLength: 4,
                sha256: 'x',
              }),
            },
          }),
        },
      }),
      variable: 'tmp_surface',
      hourToken: '000',
      signal: createSignalFixture(),
    })

    expect(frame.encoding.format).toBe('temp-c-piecewise-i8-v1')
    expect(Array.from(frame.values)).toEqual([-35, -8, -7.75, 34])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps loaded packed cloud layer payloads into decoded frame data', async () => {
    const payload = new Int8Array([
      0, 1, 20, -128,
      2, 11, 16, 5,
      3, 9, 13, 19,
    ]).buffer
    const fetchMock = stubFetchArrayBufferOnce(payload)

    const frame = await loadScalarFrame({
      config: createConfigFixture(),
      manifest: createFrameManifestFixture({
        products: {
          tmp_surface: createScalarProductFixture({
            encoding: {
              id: 'e0',
              format: 'linear-i8-v1',
              dtype: 'int8',
              byteOrder: 'none',
              nodata: -128,
              scale: 5,
              offset: 0,
              decodeFormula: 'value = stored * scale + offset',
              components: ['low', 'medium', 'high'],
            },
            frames: {
              '000': createFrameRefFixture({
                path: 'fields/2026041100/000/cloud_layers.scalar.i8.bin',
                byteLength: 12,
                sha256: 'x',
              }),
            },
          }),
        },
      }),
      variable: 'tmp_surface',
      hourToken: '000',
      signal: createSignalFixture(),
    })

    expect(frame.encoding.format).toBe('linear-i8-v1')
    expect(Array.from(frame.values)).toEqual([15, 55, 100, 95])
    expect(Array.from(frame.cloudLayers?.low.slice(0, 3) ?? [])).toEqual([0, 5, 100])
    expect(Number.isNaN(frame.cloudLayers?.low[3] ?? Number.NaN)).toBe(true)
    expect(Array.from(frame.cloudLayers?.medium ?? [])).toEqual([10, 55, 80, 25])
    expect(Array.from(frame.cloudLayers?.high ?? [])).toEqual([15, 45, 65, 95])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects packed cloud layer payloads with the wrong grid cell count', async () => {
    const payload = new Int8Array([0, 1, 2]).buffer
    stubFetchArrayBufferOnce(payload)

    await expect(
      loadScalarFrame({
        config: createConfigFixture(),
        manifest: createFrameManifestFixture({
          products: {
            tmp_surface: createScalarProductFixture({
              encoding: {
                id: 'e0',
                format: 'linear-i8-v1',
                dtype: 'int8',
                byteOrder: 'none',
                nodata: -128,
                scale: 5,
                offset: 0,
                decodeFormula: 'value = stored * scale + offset',
                components: ['low', 'medium', 'high'],
              },
              frames: {
                '000': createFrameRefFixture({
                  path: 'fields/2026041100/000/cloud_layers.scalar.i8.bin',
                  byteLength: 3,
                  sha256: 'x',
                }),
              },
            }),
          },
        }),
        variable: 'tmp_surface',
        hourToken: '000',
        signal: createSignalFixture(),
      })
    ).rejects.toThrow('Cloud layer payload cell count mismatch')
  })

  it('rejects scalar payloads with the wrong decoded cell count', async () => {
    const payload = new Int8Array([1, 2, 3]).buffer
    stubFetchArrayBufferOnce(payload)

    await expect(
      loadScalarFrame({
        config: createConfigFixture(),
        manifest: createFrameManifestFixture({
          products: {
            tmp_surface: createScalarProductFixture({
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
              frames: {
                '000': createFrameRefFixture({
                  path: 'fields/2026041100/000/tmp_surface.scalar.i8.bin',
                  byteLength: 3,
                  sha256: 'x',
                }),
              },
            }),
          },
        }),
        variable: 'tmp_surface',
        hourToken: '000',
        signal: createSignalFixture(),
      })
    ).rejects.toThrow('Scalar payload cell count mismatch')
  })

  it('rejects unsupported scalar encodings locally', async () => {
    await expect(
      loadScalarFrame({
        config: createConfigFixture(),
        manifest: createFrameManifestFixture({
          products: {
            tmp_surface: createScalarProductFixture({
              encoding: {
                id: 'e0',
                format: 'bad-format',
              } as unknown as ScalarEncodingSpec,
            }),
          },
        }),
        variable: 'tmp_surface',
        hourToken: '000',
        signal: createSignalFixture(),
      })
    ).rejects.toThrow('Unsupported scalar format')

    await expect(
      loadScalarFrame({
        config: createConfigFixture(),
        manifest: createFrameManifestFixture({
          products: {
            tmp_surface: createScalarProductFixture({
              encoding: {
                id: 'e0',
                format: 'linear-i16-v1',
                dtype: 'int16',
                byteOrder: 'little',
                scale: 0.01,
                offset: 0,
                decodeFormula: 'value = stored * scale + offset',
              } as unknown as ScalarEncodingSpec,
            }),
          },
        }),
        variable: 'tmp_surface',
        hourToken: '000',
        signal: createSignalFixture(),
      })
    ).rejects.toThrow('Scalar encoding for tmp_surface is missing nodata')
  })
})
