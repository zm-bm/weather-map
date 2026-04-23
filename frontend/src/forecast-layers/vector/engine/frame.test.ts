import { describe, expect, it, vi } from 'vitest'

import type { CycleManifest } from '../../../manifest'
import { loadVectorFrame } from './frame'
import {
  createConfigFixture,
  createFrameManifestFixture,
  createSignalFixture,
  createVectorPayloadFixture,
} from '../../../test/fixtures'

describe('vector payload', () => {
  it('loads vector payload from manifest frame and splits u/v', async () => {
    const payload = createVectorPayloadFixture([1, -2, 3, -4], [-5, 6, -7, 8])
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => payload,
    }))
    vi.stubGlobal('fetch', fetchMock)

    const frame = await loadVectorFrame({
      config: createConfigFixture(),
      manifest: createFrameManifestFixture(),
      variable: 'wind10m_uv',
      hourToken: '000',
      signal: createSignalFixture(),
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(Array.from(frame.u)).toEqual([1, -2, 3, -4])
    expect(Array.from(frame.v)).toEqual([-5, 6, -7, 8])
    expect(frame.metadata.kind).toBe('vector')
    expect(frame.metadata.hourToken).toBe('000')
    expect(frame.metadata.component_count).toBe(2)

    vi.unstubAllGlobals()
  })

  it('rejects invalid vector encodings locally', async () => {
    const baseManifest = createFrameManifestFixture()

    await expect(
      loadVectorFrame({
        config: createConfigFixture(),
        manifest: createFrameManifestFixture({
          encodings: {
            ...baseManifest.encodings,
            wind10m_uv_vector_i8_v1: {
              ...baseManifest.encodings.wind10m_uv_vector_i8_v1,
              dtype: 'int16',
            } as unknown as CycleManifest['encodings'][string],
          },
        }),
        variable: 'wind10m_uv',
        hourToken: '000',
        signal: createSignalFixture(),
      })
    ).rejects.toThrow('Unsupported vector dtype')

    await expect(
      loadVectorFrame({
        config: createConfigFixture(),
        manifest: createFrameManifestFixture({
          encodings: {
            ...baseManifest.encodings,
            wind10m_uv_vector_i8_v1: {
              ...baseManifest.encodings.wind10m_uv_vector_i8_v1,
              components: ['v', 'u'],
            } as unknown as CycleManifest['encodings'][string],
          },
        }),
        variable: 'wind10m_uv',
        hourToken: '000',
        signal: createSignalFixture(),
      })
    ).rejects.toThrow('Unsupported vector components')

    await expect(
      loadVectorFrame({
        config: createConfigFixture(),
        manifest: createFrameManifestFixture({
          encodings: {
            ...baseManifest.encodings,
            wind10m_uv_vector_i8_v1: {
              ...baseManifest.encodings.wind10m_uv_vector_i8_v1,
              scale: 1,
            } as unknown as CycleManifest['encodings'][string],
          },
        }),
        variable: 'wind10m_uv',
        hourToken: '000',
        signal: createSignalFixture(),
      })
    ).rejects.toThrow('Unsupported vector decode params')
  })
})
