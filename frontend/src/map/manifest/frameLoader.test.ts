import { describe, expect, it, vi } from 'vitest'

import type { CycleManifest } from './types'
import { loadFrame } from './frameLoader'
import {
  createConfigFixture,
  createFrameManifestFixture,
  createSignalFixture,
} from '../../test/fixtures'

const BASE_MANIFEST = createFrameManifestFixture({ forecastHours: ['000'] })

function createFetchOk(payload: ArrayBuffer) {
  return vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => payload,
  }))
}

describe('loadFrame', () => {
  it('loads scalar frame payload', async () => {
    vi.stubGlobal('fetch', createFetchOk(new Int16Array([1, 2, 3, 4]).buffer))

    const loaded = await loadFrame({
      config: createConfigFixture(),
      manifest: BASE_MANIFEST,
      hourToken: '000',
      variable: 'tmp_surface',
      domain: 'scalar',
      signal: createSignalFixture(),
    })

    expect(loaded.variableMeta.kind).toBe('scalar')
    expect(loaded.encoding.format).toBe('scalar-i16-linear-v1')
    expect(loaded.payload.byteLength).toBe(8)
    vi.unstubAllGlobals()
  })

  it('loads vector frame payload', async () => {
    vi.stubGlobal('fetch', createFetchOk(new Int8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer))

    const loaded = await loadFrame({
      config: createConfigFixture(),
      manifest: BASE_MANIFEST,
      hourToken: '000',
      variable: 'wind10m_uv',
      domain: 'vector',
      signal: createSignalFixture(),
    })

    expect(loaded.variableMeta.kind).toBe('vector')
    expect(loaded.encoding.format).toBe('uv-i8-q0p5-v1')
    expect(loaded.payload.byteLength).toBe(8)
    vi.unstubAllGlobals()
  })

  it('fails on missing frame/meta/encoding/grid', async () => {
    vi.stubGlobal('fetch', createFetchOk(new ArrayBuffer(8)))

    await expect(
      loadFrame({
        config: createConfigFixture(),
        manifest: createFrameManifestFixture({ forecastHours: ['000'], frames: {} }),
        hourToken: '000',
        variable: 'tmp_surface',
        domain: 'scalar',
        signal: createSignalFixture(),
      })
    ).rejects.toThrow('No scalar frame ref')

    await expect(
      loadFrame({
        config: createConfigFixture(),
        manifest: createFrameManifestFixture({ forecastHours: ['000'], variableMeta: {} }),
        hourToken: '000',
        variable: 'tmp_surface',
        domain: 'scalar',
        signal: createSignalFixture(),
      })
    ).rejects.toThrow('No scalar variable metadata')

    await expect(
      loadFrame({
        config: createConfigFixture(),
        manifest: createFrameManifestFixture({
          forecastHours: ['000'],
          variableMeta: {
            tmp_surface: {
              kind: 'scalar',
              units: 'C',
              parameter: 'tmp',
              level: 'surface',
              valid_min: -45,
              valid_max: 50,
              grid_id: 'g0',
              encoding_id: 'missing',
            },
            wind10m_uv: BASE_MANIFEST.variableMeta.wind10m_uv,
          },
        }),
        hourToken: '000',
        variable: 'tmp_surface',
        domain: 'scalar',
        signal: createSignalFixture(),
      })
    ).rejects.toThrow('No scalar encoding missing')

    await expect(
      loadFrame({
        config: createConfigFixture(),
        manifest: createFrameManifestFixture({
          forecastHours: ['000'],
          variableMeta: {
            tmp_surface: {
              kind: 'scalar',
              units: 'C',
              parameter: 'tmp',
              level: 'surface',
              valid_min: -45,
              valid_max: 50,
              grid_id: 'missing',
              encoding_id: 'e0',
            },
            wind10m_uv: BASE_MANIFEST.variableMeta.wind10m_uv,
          },
        }),
        hourToken: '000',
        variable: 'tmp_surface',
        domain: 'scalar',
        signal: createSignalFixture(),
      })
    ).rejects.toThrow('No scalar grid missing')

    vi.unstubAllGlobals()
  })

  it('fails on domain kind mismatch', async () => {
    vi.stubGlobal('fetch', createFetchOk(new ArrayBuffer(8)))

    await expect(
      loadFrame({
        config: createConfigFixture(),
        manifest: BASE_MANIFEST,
        hourToken: '000',
        variable: 'wind10m_uv',
        domain: 'scalar',
        signal: createSignalFixture(),
      })
    ).rejects.toThrow('is not scalar')

    await expect(
      loadFrame({
        config: createConfigFixture(),
        manifest: BASE_MANIFEST,
        hourToken: '000',
        variable: 'tmp_surface',
        domain: 'vector',
        signal: createSignalFixture(),
      })
    ).rejects.toThrow('is not vector')

    vi.unstubAllGlobals()
  })

  it('fails strict encoding invariants', async () => {
    vi.stubGlobal('fetch', createFetchOk(new ArrayBuffer(8)))

    await expect(
      loadFrame({
        config: createConfigFixture(),
        manifest: createFrameManifestFixture({
          forecastHours: ['000'],
          encodings: {
            ...BASE_MANIFEST.encodings,
            e0: {
              ...BASE_MANIFEST.encodings.e0,
              format: 'bad-format',
            } as unknown as CycleManifest['encodings'][string],
          },
        }),
        hourToken: '000',
        variable: 'tmp_surface',
        domain: 'scalar',
        signal: createSignalFixture(),
      })
    ).rejects.toThrow('Unsupported scalar format')

    await expect(
      loadFrame({
        config: createConfigFixture(),
        manifest: createFrameManifestFixture({
          forecastHours: ['000'],
          encodings: {
            ...BASE_MANIFEST.encodings,
            wind10m_uv_vector_i8_v1: {
              ...BASE_MANIFEST.encodings.wind10m_uv_vector_i8_v1,
              dtype: 'int16',
            } as unknown as CycleManifest['encodings'][string],
          },
        }),
        hourToken: '000',
        variable: 'wind10m_uv',
        domain: 'vector',
        signal: createSignalFixture(),
      })
    ).rejects.toThrow('Unsupported vector dtype')

    await expect(
      loadFrame({
        config: createConfigFixture(),
        manifest: createFrameManifestFixture({
          forecastHours: ['000'],
          encodings: {
            ...BASE_MANIFEST.encodings,
            wind10m_uv_vector_i8_v1: {
              ...BASE_MANIFEST.encodings.wind10m_uv_vector_i8_v1,
              components: ['v', 'u'],
            } as unknown as CycleManifest['encodings'][string],
          },
        }),
        hourToken: '000',
        variable: 'wind10m_uv',
        domain: 'vector',
        signal: createSignalFixture(),
      })
    ).rejects.toThrow('Unsupported vector components')

    await expect(
      loadFrame({
        config: createConfigFixture(),
        manifest: createFrameManifestFixture({
          forecastHours: ['000'],
          encodings: {
            ...BASE_MANIFEST.encodings,
            wind10m_uv_vector_i8_v1: {
              ...BASE_MANIFEST.encodings.wind10m_uv_vector_i8_v1,
              scale: 1,
            },
          },
        }),
        hourToken: '000',
        variable: 'wind10m_uv',
        domain: 'vector',
        signal: createSignalFixture(),
      })
    ).rejects.toThrow('Unsupported vector decode params')

    vi.unstubAllGlobals()
  })

  it('fails byte-length mismatch', async () => {
    vi.stubGlobal('fetch', createFetchOk(new Int16Array([1, 2, 3, 4]).buffer))

    await expect(
      loadFrame({
        config: createConfigFixture(),
        manifest: createFrameManifestFixture({
          forecastHours: ['000'],
          frames: {
            '000': {
              ...BASE_MANIFEST.frames['000'],
              tmp_surface: {
                ...BASE_MANIFEST.frames['000'].tmp_surface,
                byte_length: 10,
              },
            },
          },
        }),
        hourToken: '000',
        variable: 'tmp_surface',
        domain: 'scalar',
        signal: createSignalFixture(),
      })
    ).rejects.toThrow('Unexpected scalar payload size')

    vi.unstubAllGlobals()
  })

  it('fails sha verification mismatch when enabled', async () => {
    const payload = new Int16Array([1, 2, 3, 4]).buffer
    const fetchMock = createFetchOk(payload)
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      loadFrame({
        config: createConfigFixture({ verifyScalarSha256: true }),
        manifest: createFrameManifestFixture({
          forecastHours: ['000'],
          frames: {
            '000': {
              ...BASE_MANIFEST.frames['000'],
              tmp_surface: {
                ...BASE_MANIFEST.frames['000'].tmp_surface,
                sha256: 'deadbeef',
              },
            },
          },
        }),
        hourToken: '000',
        variable: 'tmp_surface',
        domain: 'scalar',
        signal: createSignalFixture(),
      })
    ).rejects.toThrow('Scalar SHA-256 mismatch')

    await expect(
      loadFrame({
        config: createConfigFixture({ verifyScalarSha256: true }),
        manifest: createFrameManifestFixture({
          forecastHours: ['000'],
          frames: {
            '000': {
              ...BASE_MANIFEST.frames['000'],
              wind10m_uv: {
                ...BASE_MANIFEST.frames['000'].wind10m_uv,
                sha256: 'cafebabe',
              },
            },
          },
        }),
        hourToken: '000',
        variable: 'wind10m_uv',
        domain: 'vector',
        signal: createSignalFixture(),
      })
    ).rejects.toThrow('Vector SHA-256 mismatch')

    vi.unstubAllGlobals()
  })
})
