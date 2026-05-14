import { afterEach, describe, expect, it, vi } from 'vitest'

import { createArtifactLoader } from '../../forecast-artifacts'
import { PARTICLE_LAYERS } from '../../forecast-catalog'
import type { VectorEncodingSpec } from '../../manifest'
import {
  createConfigFixture,
  createFrameManifestFixture,
  createScalarProductFixture,
  createSignalFixture,
  createVectorProductFixture,
  createVectorPayloadFixture,
} from '../../test/fixtures'
import { stubFetchArrayBufferOnce } from '../../test/fetch'
import { createParticleChannel } from '.'

afterEach(() => {
  vi.unstubAllGlobals()
})

function particleChannel(manifest: ReturnType<typeof createFrameManifestFixture>) {
  return createParticleChannel({
    manifest,
    particleLayer: PARTICLE_LAYERS[0]!,
    artifacts: createArtifactLoader({
      config: createConfigFixture(),
      manifest,
      signal: createSignalFixture(),
    }),
  })
}

describe('createParticleChannel', () => {
  it('loads particle channels from vector artifacts', async () => {
    const payload = createVectorPayloadFixture([1, -2, 3, -4], [-5, 6, -7, 8])
    const fetchMock = stubFetchArrayBufferOnce(payload)
    const manifest = createFrameManifestFixture({
      cycle: '2026041200',
    })

    const frame = await particleChannel(manifest).load('000')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(Array.from(frame.u)).toEqual([1, -2, 3, -4])
    expect(Array.from(frame.v)).toEqual([-5, 6, -7, 8])
    expect(frame.hourToken).toBe('000')
  })

  it('rejects invalid vector metadata before fetching particle payloads', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const baseEncoding = createVectorProductFixture().encoding

    await expect(
      particleChannel(createFrameManifestFixture({
        products: {
          tmp_surface: createScalarProductFixture(),
          wind10m_uv: createVectorProductFixture({
            encoding: {
              ...baseEncoding,
              dtype: 'int16',
            } as unknown as VectorEncodingSpec,
          }),
        },
      })).load('000')
    ).rejects.toThrow('Unsupported vector dtype')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects particle channel loads for artifacts assigned to another kind', async () => {
    await expect(
      particleChannel(createFrameManifestFixture({
        products: {
          tmp_surface: createScalarProductFixture(),
          wind10m_uv: {
            ...createScalarProductFixture(),
            id: 'wind10m_uv',
          },
        },
      })).load('000')
    ).rejects.toThrow('Artifact wind10m_uv is not vector')
  })
})
