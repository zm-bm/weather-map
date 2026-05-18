import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFetchErrorResponse, stubFetchJsonOnce } from '../test/fetch'
import { fetchAvailabilityIndex } from './fetch'

afterEach(() => {
  vi.unstubAllGlobals()
})

function createAvailabilityIndexPayload() {
  return {
    schema: 'weather-map-model-layer-availability-index',
    schemaVersion: 2,
    generatedAt: '2026-05-16T00:00:00Z',
    catalogVersion: 'forecast-catalog-v1',
    models: {
      gfs: {
        label: 'GFS',
        latest: {
          schema: 'weather-map.cycle-manifest',
          schemaVersion: 5,
          payloadContract: 'forecast-binary-v2',
          run: {
            cycle: '2026040900',
            generatedAt: '2026-04-09T00:00:00Z',
            revision: 'test-revision',
          },
          times: [
            {
              id: '000',
              leadHours: 0,
              validAt: '2026-04-09T00:00:00Z',
            },
          ],
          artifacts: {
            tmp_surface: {
              id: 'tmp_surface',
              kind: 'scalar',
              units: 'C',
              parameter: 'tmp',
              level: 'surface',
              components: ['value'],
              grid: {
                id: 'gfs_0p25_global',
                crs: 'EPSG:4326',
                nx: 2,
                ny: 2,
                lon0: 0,
                lat0: 0,
                dx: 1,
                dy: 1,
                origin: 'cell_center',
                layout: 'row_major',
                xWrap: 'repeat',
                yMode: 'clamp',
              },
              encoding: {
                id: 'tmp_surface_i16_v1',
                format: 'linear-i16-v1',
                dtype: 'int16',
                byteOrder: 'little',
                nodata: -32768,
                scale: 0.01,
                offset: 0,
                decodeFormula: 'value = stored * scale + offset',
              },
              byteLength: 8,
            },
          },
        },
      },
    },
    layers: {
      temperature: {
        models: {
          gfs: {
            state: 'available',
            support: 'native',
            requiredArtifacts: ['tmp_surface'],
            optionalArtifacts: [],
          },
        },
      },
    },
  }
}

describe('fetchAvailabilityIndex', () => {
  it('fetches the global model/layer availability index', async () => {
    const fetchMock = stubFetchJsonOnce(createAvailabilityIndexPayload())

    const availabilityIndex = await fetchAvailabilityIndex()

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/manifests/availability-index.json',
      expect.any(Object)
    )
    const artifact = availabilityIndex.models.gfs?.latest?.artifacts.tmp_surface
    expect(artifact?.byteLength).toBe(8)
    expect(artifact).not.toHaveProperty('frames')
    expect(artifact).not.toHaveProperty('path')
    expect(artifact).not.toHaveProperty('sha256')
  })

  it('fails on non-ok responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createFetchErrorResponse(404, 'Not Found'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchAvailabilityIndex()).rejects.toThrow(
      'Failed to fetch availability index: 404 Not Found'
    )
  })

  it('rejects legacy v1 availability payloads', async () => {
    stubFetchJsonOnce({
      ...createAvailabilityIndexPayload(),
      schemaVersion: 1,
    })

    await expect(fetchAvailabilityIndex()).rejects.toThrow()
  })
})
