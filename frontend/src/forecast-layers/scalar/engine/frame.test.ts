import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CycleManifest } from '../../../manifest'
import { decodeScalarPayloadInt16, loadScalarFrame } from './frame'
import {
  createConfigFixture,
  createFrameManifestFixture,
  createScalarPayloadFixture,
  createSignalFixture,
} from '../../../test/fixtures'
import { stubFetchArrayBufferOnce } from '../../../test/fetch'

afterEach(() => {
  vi.unstubAllGlobals()
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

  it('maps loaded scalar payload into frame data', async () => {
    const payload = createScalarPayloadFixture([1, 2, 3, 4])
    const fetchMock = stubFetchArrayBufferOnce(payload)

    const frame = await loadScalarFrame({
      config: createConfigFixture(),
      manifest: createFrameManifestFixture({
        cycle: '2026041100',
        generatedAt: '2026-04-11T00:00:00Z',
        grids: {
          g0: {
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
          },
        },
        frames: {
          '000': {
            tmp_surface: {
              path: 'fields/2026041100/000/tmp_surface.scalar.i16.bin',
              byte_length: 8,
              sha256: 'x',
            },
          },
        },
      }),
      variable: 'tmp_surface',
      hourToken: '000',
      signal: createSignalFixture(),
    })

    expect(frame.variableId).toBe('tmp_surface')
    expect(frame.grid.nx).toBe(2)
    expect(Array.from(frame.values)).toEqual([1, 2, 3, 4])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects unsupported scalar encodings locally', async () => {
    const baseManifest = createFrameManifestFixture()

    await expect(
      loadScalarFrame({
        config: createConfigFixture(),
        manifest: createFrameManifestFixture({
          encodings: {
            ...baseManifest.encodings,
            e0: {
              ...baseManifest.encodings.e0,
              format: 'bad-format',
            } as unknown as CycleManifest['encodings'][string],
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
          encodings: {
            ...baseManifest.encodings,
            e0: {
              format: 'scalar-i16-linear-v1',
              dtype: 'int16',
              byte_order: 'little',
              scale: 0.01,
              offset: 0,
              decode_formula: 'value = stored * scale + offset',
            } as unknown as CycleManifest['encodings'][string],
          },
        }),
        variable: 'tmp_surface',
        hourToken: '000',
        signal: createSignalFixture(),
      })
    ).rejects.toThrow('Scalar encoding for tmp_surface is missing nodata')
  })
})
