import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createConfigFixture,
  createFrameManifestFixture,
  createFrameRefFixture,
  createScalarProductFixture,
  createVectorProductFixture,
  FIXTURE_SCALAR_ID,
  FIXTURE_VECTOR_ID,
} from '../test/fixtures'
import { stubFetchArrayBufferOnce } from '../test/fetch'
import { __resetPayloadFrameCacheForTests } from '../forecast-cache/payloadFrameCache'
import { prefetchFramePayloads } from './prefetch'

afterEach(() => {
  vi.unstubAllGlobals()
  return __resetPayloadFrameCacheForTests()
})

describe('prefetchFramePayloads', () => {
  it('warms frame payloads through the shared loader cache', async () => {
    const manifest = createFrameManifestFixture({
      forecastHours: ['000'],
      products: {
        [FIXTURE_SCALAR_ID]: createScalarProductFixture({
          frames: {
            '000': createFrameRefFixture({
              path: 'fields/2026041312/000/tmp_surface.scalar.i16.bin',
            }),
          },
        }),
        [FIXTURE_VECTOR_ID]: createVectorProductFixture({
          frames: {
            '000': createFrameRefFixture({
              path: 'fields/2026041312/000/wind10m_uv.vector.i8.bin',
            }),
          },
        }),
      },
    })
    const fetchMock = stubFetchArrayBufferOnce(new Int16Array([1, 2, 3, 4]).buffer)

    await prefetchFramePayloads({
      config: createConfigFixture(),
      manifest,
      frameKind: 'scalar',
      variableId: FIXTURE_SCALAR_ID,
      hourTokens: ['000', '0'],
      signal: new AbortController().signal,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
