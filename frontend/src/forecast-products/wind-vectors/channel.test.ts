import { afterEach, describe, expect, it, vi } from 'vitest'

import { createArtifactLoader } from '../../forecast-artifacts'
import type { VectorEncodingSpec } from '../../forecast-manifest'
import {
  createActiveRunFixture,
  createConfigFixture,
  createSingleTimeManifestFixture,
  createScalarArtifactFixture,
  createSignalFixture,
  createVectorArtifactFixture,
  createVectorPayloadFixture,
} from '../../test/fixtures'
import { stubFetchArrayBufferOnce } from '../../test/fetch'
import { createWindVectorChannel } from './channel'

afterEach(() => {
  vi.unstubAllGlobals()
})

function windVectorChannel(manifest: ReturnType<typeof createSingleTimeManifestFixture>) {
  const activeRun = createActiveRunFixture(manifest)
  return createWindVectorChannel({
    activeRun,
    source: {
      id: 'wind',
      artifactId: 'wind10m_uv',
    },
    artifacts: createArtifactLoader({
      config: createConfigFixture(),
      activeRun,
      signal: createSignalFixture(),
    }),
  })
}

describe('createWindVectorChannel', () => {
  it('loads wind vector channels from vector artifacts', async () => {
    const payload = createVectorPayloadFixture([1, -2, 3, -4], [-5, 6, -7, 8])
    const fetchMock = stubFetchArrayBufferOnce(payload)
    const manifest = createSingleTimeManifestFixture({
      cycle: '2026041200',
    })

    const frame = await windVectorChannel(manifest).load('000')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(Array.from(frame.u)).toEqual([1, -2, 3, -4])
    expect(Array.from(frame.v)).toEqual([-5, 6, -7, 8])
    expect(frame.hourToken).toBe('000')
  })

  it('rejects invalid vector metadata before fetching wind vector payloads', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const baseEncoding = createVectorArtifactFixture().encoding

    await expect(
      windVectorChannel(createSingleTimeManifestFixture({
        artifacts: {
          tmp_surface: createScalarArtifactFixture(),
          wind10m_uv: createVectorArtifactFixture({
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

  it('rejects wind vector channel loads for artifacts assigned to another kind', async () => {
    await expect(
      windVectorChannel(createSingleTimeManifestFixture({
        artifacts: {
          tmp_surface: createScalarArtifactFixture(),
          wind10m_uv: {
            ...createScalarArtifactFixture(),
            id: 'wind10m_uv',
          },
        },
      })).load('000')
    ).rejects.toThrow('Artifact wind10m_uv is not vector')
  })
})
