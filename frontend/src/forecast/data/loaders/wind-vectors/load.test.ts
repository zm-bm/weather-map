import { afterEach, describe, expect, it, vi } from 'vitest'

import { createArtifactLoader } from '@/forecast/artifacts'
import type { VectorEncodingSpec } from '@/forecast/manifest'
import {
  createActiveRunFixture,
  createConfigFixture,
  createSingleTimeManifestFixture,
  createScalarArtifactFixture,
  createSignalFixture,
  createVectorArtifactFixture,
  createVectorPayloadFixture,
} from '@/test/fixtures'
import { stubFetchArrayBufferOnce } from '@/test/fetch'
import { createWindVectorDataLoad } from './load'

afterEach(() => {
  vi.unstubAllGlobals()
})

function windVectorLoad(
  manifest: ReturnType<typeof createSingleTimeManifestFixture>
): NonNullable<ReturnType<typeof createWindVectorDataLoad>>
function windVectorLoad(
  manifest: ReturnType<typeof createSingleTimeManifestFixture>,
  options: { requireLoad: false }
): ReturnType<typeof createWindVectorDataLoad>
function windVectorLoad(
  manifest: ReturnType<typeof createSingleTimeManifestFixture>,
  options: { requireLoad?: boolean } = {}
) {
  const activeRun = createActiveRunFixture(manifest)
  const load = createWindVectorDataLoad({
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
  if ((options.requireLoad ?? true) && load == null) {
    throw new Error('Expected wind vector data load fixture')
  }
  return load
}

describe('createWindVectorDataLoad', () => {
  it('loads wind vector channels from vector artifacts', async () => {
    const payload = createVectorPayloadFixture([1, -2, 3, -4], [-5, 6, -7, 8])
    const fetchMock = stubFetchArrayBufferOnce(payload)
    const manifest = createSingleTimeManifestFixture({
      cycle: '2026041200',
    })

    const frame = await windVectorLoad(manifest).loadTimeSlice('000')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(Array.from(frame.u)).toEqual([1, -2, 3, -4])
    expect(Array.from(frame.v)).toEqual([-5, 6, -7, 8])
    expect(frame.hourToken).toBe('000')
  })

  it('omits invalid vector metadata before fetching wind vector payloads', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const baseEncoding = createVectorArtifactFixture().encoding

    expect(
      windVectorLoad(createSingleTimeManifestFixture({
        artifacts: {
          tmp_surface: createScalarArtifactFixture(),
          wind10m_uv: createVectorArtifactFixture({
            encoding: {
              ...baseEncoding,
              dtype: 'int16',
            } as unknown as VectorEncodingSpec,
          }),
        },
      }), { requireLoad: false })
    ).toBeNull()

    expect(
      windVectorLoad(createSingleTimeManifestFixture({
        artifacts: {
          tmp_surface: createScalarArtifactFixture(),
          wind10m_uv: createVectorArtifactFixture({
            components: ['v', 'u'],
          }),
        },
      }), { requireLoad: false })
    ).toBeNull()

    expect(
      windVectorLoad(createSingleTimeManifestFixture({
        artifacts: {
          tmp_surface: createScalarArtifactFixture(),
          wind10m_uv: createVectorArtifactFixture({
            encoding: {
              ...baseEncoding,
              scale: 1,
            },
          }),
        },
      }), { requireLoad: false })
    ).toBeNull()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('omits wind-vector data loads for artifacts assigned to another kind', () => {
    expect(
      windVectorLoad(createSingleTimeManifestFixture({
        artifacts: {
          tmp_surface: createScalarArtifactFixture(),
          wind10m_uv: {
            ...createScalarArtifactFixture(),
            id: 'wind10m_uv',
          },
        },
      }), { requireLoad: false })
    ).toBeNull()
  })
})
