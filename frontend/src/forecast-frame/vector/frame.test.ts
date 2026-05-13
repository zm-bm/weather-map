import { afterEach, describe, expect, it, vi } from 'vitest'

import type { VectorEncodingSpec } from '../../manifest'
import { loadVectorFrame } from './frame'
import {
  createConfigFixture,
  createFrameManifestFixture,
  createScalarProductFixture,
  createSignalFixture,
  createVectorProductFixture,
  createVectorPayloadFixture,
} from '../../test/fixtures'
import { stubFetchArrayBufferOnce } from '../../test/fetch'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('vector payload', () => {
  it('loads vector payload from manifest frame and splits u/v', async () => {
    const payload = createVectorPayloadFixture([1, -2, 3, -4], [-5, 6, -7, 8])
    const fetchMock = stubFetchArrayBufferOnce(payload)

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
  })

  it('rejects invalid vector encodings locally', async () => {
    const baseEncoding = createVectorProductFixture().encoding

    await expect(
      loadVectorFrame({
        config: createConfigFixture(),
        manifest: createFrameManifestFixture({
          products: {
            wind10m_uv: createVectorProductFixture({
              encoding: {
                ...baseEncoding,
                dtype: 'int16',
              } as unknown as VectorEncodingSpec,
            }),
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
          products: {
            wind10m_uv: createVectorProductFixture({
              components: ['v', 'u'],
            }),
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
          products: {
            wind10m_uv: createVectorProductFixture({
              encoding: {
                ...baseEncoding,
                scale: 1,
              } as unknown as VectorEncodingSpec,
            }),
          },
        }),
        variable: 'wind10m_uv',
        hourToken: '000',
        signal: createSignalFixture(),
      })
    ).rejects.toThrow('Unsupported vector decode params')
  })

  it('rejects vector frame loads for artifacts assigned to another kind', async () => {
    await expect(
      loadVectorFrame({
        config: createConfigFixture(),
        manifest: createFrameManifestFixture({
          products: {
            wind10m_uv: {
              ...createScalarProductFixture(),
              id: 'wind10m_uv',
            },
          },
        }),
        variable: 'wind10m_uv',
        hourToken: '000',
        signal: createSignalFixture(),
      })
    ).rejects.toThrow('Variable wind10m_uv is not vector')
  })
})
